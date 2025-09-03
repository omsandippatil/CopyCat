let lastAIResponse = null;
let lastFocusedElement = null;
let mousePosition = { x: 0, y: 0 };

// Track mouse position and focused elements
function trackInteractions() {
  document.addEventListener('mousemove', (e) => {
    mousePosition = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener('focusin', (e) => {
    if (e.target && (
      e.target.tagName === 'INPUT' || 
      e.target.tagName === 'TEXTAREA' || 
      e.target.contentEditable === 'true' ||
      e.target.closest('.CodeMirror') ||
      e.target.closest('.monaco-editor') ||
      e.target.closest('.ace_editor')
    )) {
      lastFocusedElement = e.target;
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target && (
      e.target.tagName === 'INPUT' || 
      e.target.tagName === 'TEXTAREA' || 
      e.target.contentEditable === 'true' ||
      e.target.closest('.CodeMirror') ||
      e.target.closest('.monaco-editor') ||
      e.target.closest('.ace_editor')
    )) {
      lastFocusedElement = e.target;
    }
  });
}

// Enhanced JSON extraction with better parsing logic
function extractJSONFromResponse(response) {
  // Method 1: Remove <think> tags and other unwanted content first
  let cleanedResponse = response
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>[\s\S]*?<think>/gi, '')
    .trim();
  
  // Method 2: Look for ``` code block with json
  const jsonCodeBlockMatch = cleanedResponse.match(/```\s*(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonCodeBlockMatch) {
    try {
      const jsonStr = jsonCodeBlockMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        return parsed;
      }
    } catch (e) {
      // Continue to other methods
    }
  }
  
  // Method 3: Look for JSON object patterns - multiple approaches
  const jsonPatterns = [
    // Match complete JSON objects with actions array
    /\{\s*"actions"\s*:\s*\[[^\]]*\][^}]*\}/g,
    // More flexible pattern for JSON objects
    /\{[^{}]*"actions"\s*:\s*\[[^\]]*(?:\{[^}]*\}[^\]]*)*\][^}]*\}/g,
    // Simple brace matching from first { to last }
    /\{[\s\S]*\}/g
  ];

  for (const pattern of jsonPatterns) {
    const matches = cleanedResponse.match(pattern);
    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          if (parsed.actions && Array.isArray(parsed.actions)) {
            return parsed;
          }
        } catch (e) {
          continue;
        }
      }
    }
  }

  // Method 4: Manual brace counting approach
  let startIndex = cleanedResponse.indexOf('{');
  if (startIndex !== -1) {
    let braceCount = 0;
    let endIndex = -1;
    
    for (let i = startIndex; i < cleanedResponse.length; i++) {
      const char = cleanedResponse[i];
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }
    
    if (endIndex !== -1) {
      try {
        const jsonStr = cleanedResponse.substring(startIndex, endIndex + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.actions && Array.isArray(parsed.actions)) {
          return parsed;
        }
      } catch (e) {
        // Continue to other methods
      }
    }
  }

  // Method 5: Try to find and extract just the actions array
  const actionsMatch = cleanedResponse.match(/"actions"\s*:\s*(\[[^\]]*(?:\{[^}]*\}[^\]]*)*\])/);
  if (actionsMatch) {
    try {
      const actionsArray = JSON.parse(actionsMatch[1]);
      if (Array.isArray(actionsArray)) {
        return { actions: actionsArray };
      }
    } catch (e) {
      // Continue to other methods
    }
  }

  // Method 6: Last resort - try to construct JSON from key parts
  const elementIdMatches = cleanedResponse.match(/"elementId"\s*:\s*"([^"]*)"/g);
  const actionMatches = cleanedResponse.match(/"action"\s*:\s*"([^"]*)"/g);
  const valueMatches = cleanedResponse.match(/"value"\s*:\s*"([^"]*)"/g);
  
  if (elementIdMatches && actionMatches && valueMatches && 
      elementIdMatches.length === actionMatches.length && 
      actionMatches.length === valueMatches.length) {
    
    try {
      const actions = [];
      for (let i = 0; i < elementIdMatches.length; i++) {
        const elementId = elementIdMatches[i].match(/"([^"]*)"/)[1];
        const action = actionMatches[i].match(/"([^"]*)"/)[1];
        const value = valueMatches[i].match(/"([^"]*)"/)[1];
        
        actions.push({ elementId, action, value });
      }
      
      if (actions.length > 0) {
        return { actions };
      }
    } catch (e) {
      // Continue to other methods
    }
  }

  // Method 7: Try parsing after more aggressive cleaning
  const aggressivelyCleaned = cleanedResponse
    .replace(/```[^`]*```/g, '')
    .replace(/^\s*\w+.*?\n/gm, '')
    .replace(/^[^{]*/g, '')
    .replace(/[^}]*$/g, '}')
    .trim();
    
  if (aggressivelyCleaned.startsWith('{') && aggressivelyCleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(aggressivelyCleaned);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        return parsed;
      }
    } catch (e) {
      // Final attempt failed
    }
  }

  return null;
}

// Function to inject and run page capture
function capturePageData() {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           element.offsetWidth > 0 && 
           element.offsetHeight > 0;
  }

  function extractPageText() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    let text = '';
    let node;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent.trim();
      if (nodeText && nodeText.length > 1) {
        text += nodeText + ' ';
      }
    }
    
    return text.trim();
  }

  function getElementLabel(element) {
    const methods = [
      () => element.getAttribute('aria-label'),
      () => element.placeholder,
      () => element.title,
      () => element.textContent?.trim(),
      () => {
        if (element.id) {
          const label = document.querySelector(`label[for="${element.id}"]`);
          return label?.textContent.trim();
        }
        return '';
      },
      () => {
        const parent = element.closest('label');
        return parent?.textContent.replace(element.value || '', '').trim();
      },
      () => {
        let prev = element.previousElementSibling;
        let attempts = 0;
        while (prev && attempts < 3) {
          const text = prev.textContent?.trim();
          if (text && text.length < 100 && text.length > 2) {
            return text;
          }
          prev = prev.previousElementSibling;
          attempts++;
        }
        return '';
      }
    ];
    
    for (const method of methods) {
      try {
        const result = method();
        if (result && result.length > 0) {
          return result;
        }
      } catch (e) {
        continue;
      }
    }
    
    return '';
  }

  function isCodeEditor(element) {
    const codeEditorClasses = [
      'CodeMirror', 'monaco', 'ace_editor', 'cm-editor', 
      'codemirror', 'code-editor', 'editor'
    ];
    
    return codeEditorClasses.some(cls => 
      element.className.toLowerCase().includes(cls.toLowerCase())
    ) || element.id.toLowerCase().includes('editor') ||
       element.closest('.CodeMirror') || element.closest('.monaco-editor');
  }

  function findInteractiveElements() {
    const elements = [];
    
    // Text inputs, textareas, and code editors
    const textInputs = document.querySelectorAll(`
      input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), 
      textarea, 
      [contenteditable="true"],
      .CodeMirror-code,
      .monaco-editor,
      .ace_editor,
      .cm-editor,
      .codemirror-wrapper,
      #editor,
      [class*="code-editor"],
      [class*="editor"]
    `);
    
    textInputs.forEach((el, index) => {
      if (isVisible(el)) {
        elements.push({
          id: el.id || `input_${index}_${Date.now()}`,
          type: 'text_input',
          tagName: el.tagName.toLowerCase(),
          inputType: el.type || 'text',
          placeholder: el.placeholder || '',
          name: el.name || '',
          className: el.className || '',
          label: getElementLabel(el),
          currentValue: el.value || el.textContent || '',
          isCodeEditor: isCodeEditor(el)
        });
      }
    });
    
    // Buttons and clickable elements with better text extraction
    const clickables = document.querySelectorAll(`
      button, 
      input[type="button"], 
      input[type="submit"], 
      input[type="radio"], 
      input[type="checkbox"],
      [role="button"],
      .btn,
      .button,
      [onclick],
      a[href],
      option
    `);
    
    clickables.forEach((el, index) => {
      if (isVisible(el)) {
        const text = el.textContent?.trim() || el.value || el.innerText?.trim() || '';
        elements.push({
          id: el.id || `clickable_${index}_${Date.now()}`,
          type: 'clickable',
          tagName: el.tagName.toLowerCase(),
          inputType: el.type || '',
          text: text,
          label: getElementLabel(el),
          checked: el.checked || false,
          disabled: el.disabled || false,
          value: el.value || text
        });
      }
    });
    
    // Select dropdowns with enhanced option extraction
    const selects = document.querySelectorAll('select');
    selects.forEach((el, index) => {
      if (isVisible(el)) {
        const options = Array.from(el.options).map(opt => ({
          value: opt.value,
          text: opt.text,
          selected: opt.selected,
          id: opt.id || `option_${index}_${Array.from(el.options).indexOf(opt)}`
        }));
        
        elements.push({
          id: el.id || `select_${index}_${Date.now()}`,
          type: 'select',
          tagName: 'select',
          name: el.name || '',
          label: getElementLabel(el),
          options: options,
          selectedValue: el.value
        });
      }
    });
    
    return elements;
  }

  try {
    // Initialize tracking
    if (typeof trackInteractions === 'function') {
      trackInteractions();
    }

    const pageContent = extractPageText();
    const interactiveElements = findInteractiveElements();
    
    return {
      url: window.location.href,
      title: document.title,
      domain: window.location.hostname,
      pageContent: pageContent,
      interactiveElements: interactiveElements,
      timestamp: Date.now()
    };
  } catch (error) {
    return null;
  }
}

// Enhanced action execution with proper tab handling
function executeActions(actions) {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomDelay(min = 100, max = 300) {
    return min + Math.random() * (max - min);
  }

  function humanTypingSpeed() {
    return 50 + Math.random() * 100;
  }

  // Simplified element finder - only used for click/select actions
  function findClickableElement(elementId, actionValue = null) {
    // Strategy 1: Direct ID match
    let element = document.getElementById(elementId);
    if (element) {
      return element;
    }
    
    // Strategy 2: If we have an action value, try to find matching option/button
    if (actionValue) {
      // Look for buttons/options with matching text
      const clickables = document.querySelectorAll(`
        button, input[type="button"], input[type="submit"], input[type="radio"], 
        input[type="checkbox"], [role="button"], .btn, .button, option, a
      `);
      
      for (const el of clickables) {
        const elementText = (el.textContent || el.value || el.innerText || '').trim().toLowerCase();
        const searchValue = actionValue.toString().toLowerCase();
        
        if (elementText.includes(searchValue) || searchValue.includes(elementText)) {
          return el;
        }
      }
    }
    
    // Strategy 3: Original fallback methods
    const fallbackStrategies = [
      () => document.querySelector(`[name="${elementId}"]`),
      () => document.querySelector(`[value="${elementId}"]`),
      () => document.querySelector(`[class*="${elementId}"]`),
      () => {
        const allElements = document.querySelectorAll('button, input, select, textarea, [contenteditable]');
        for (const el of allElements) {
          if (el.textContent?.trim().includes(elementId) || 
              el.value?.includes(elementId) ||
              el.getAttribute('aria-label')?.includes(elementId)) {
            return el;
          }
        }
        return null;
      }
    ];
    
    for (const strategy of fallbackStrategies) {
      try {
        const result = strategy();
        if (result) {
          return result;
        }
      } catch (e) {
        continue;
      }
    }
    
    return null;
  }

  // Get the currently focused element or active element
  function getCurrentlyFocusedElement() {
    // First check document.activeElement
    if (document.activeElement && 
        document.activeElement !== document.body &&
        document.activeElement !== document.documentElement) {
      return document.activeElement;
    }
    
    // Check if we have a tracked focused element
    if (window.lastFocusedElement) {
      return window.lastFocusedElement;
    }
    
    // Look for element with cursor or selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.contentEditable === 'true')) {
        return element;
      }
    }
    
    return null;
  }

  // Enhanced tab handling for proper indentation
  function processTabsInText(text) {
    // Convert \t characters to appropriate spaces (4 spaces per tab)
    return text.replace(/\t/g, '    ');
  }

  async function typeAtCurrentPosition(text) {
    try {
      // Process tabs in the text
      const processedText = processTabsInText(text);
      
      // Get the currently focused element
      const element = getCurrentlyFocusedElement();
      
      if (!element) {
        // If no element is focused, just simulate keyboard typing with proper tab handling
        for (let i = 0; i < processedText.length; i++) {
          const char = processedText[i];
          
          // Handle tab characters specially
          if (char === ' ' && processedText.substring(i, i + 4) === '    ' && 
              (i === 0 || processedText[i - 1] === '\n')) {
            // This is likely a tab converted to spaces at line start
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
            i += 3; // Skip the next 3 spaces
          } else {
            // Regular character
            document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
            document.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          }
          
          await sleep(humanTypingSpeed());
        }
        
        return true;
      }

      // Handle code editors first
      if (isCodeEditor(element)) {
        const handled = await handleCodeEditor(element, text); // Use original text for code editors
        if (handled) {
          return true;
        }
      }
      
      // Regular typing simulation on focused element with tab handling
      const typingSuccess = await simulateHumanTypingWithTabs(element, text);
      if (!typingSuccess) {
        return false;
      }
      return true;

    } catch (error) {
      return false;
    }
  }

  async function simulateHumanTypingWithTabs(element, text) {
    try {
      // Focus the element
      element.focus();
      await sleep(100);
      
      // Clear existing content
      const currentValue = element.value || element.textContent || '';
      if (currentValue) {
        element.select();
        await sleep(50);
        
        // Send delete/backspace
        for (let i = 0; i < currentValue.length; i++) {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
          await sleep(10);
        }
      }
      
      // Clear the value
      if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
        element.value = '';
      } else if (element.contentEditable === 'true') {
        element.textContent = '';
      }
      
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      
      // Type character by character with proper tab handling
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // Handle tab character
        if (char === '\t') {
          // Simulate tab key press
          const tabEvent = new KeyboardEvent('keydown', { 
            key: 'Tab', 
            code: 'Tab',
            bubbles: true, 
            cancelable: true 
          });
          
          element.dispatchEvent(tabEvent);
          
          // If tab was not handled by the element, insert spaces
          if (!tabEvent.defaultPrevented) {
            const tabSpaces = '    '; // 4 spaces for tab
            
            if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
              const start = element.selectionStart;
              const end = element.selectionEnd;
              const value = element.value;
              element.value = value.substring(0, start) + tabSpaces + value.substring(end);
              element.setSelectionRange(start + tabSpaces.length, start + tabSpaces.length);
            } else if (element.contentEditable === 'true') {
              document.execCommand('insertText', false, tabSpaces);
            }
          }
          
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
        } else {
          // Handle regular character
          if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const value = element.value;
            element.value = value.substring(0, start) + char + value.substring(end);
            element.setSelectionRange(start + 1, start + 1);
          } else if (element.contentEditable === 'true') {
            document.execCommand('insertText', false, char);
          }
          
          // Dispatch realistic events
          element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
          element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        
        await sleep(humanTypingSpeed());
      }
      
      // Final events
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      
      return true;
    } catch (error) {
      return false;
    }
  }

  async function handleCodeEditor(element, code) {
    try {
      // CodeMirror handling
      if (element.className.includes('CodeMirror') || element.closest('.CodeMirror')) {
        const cmContainer = element.closest('.CodeMirror') || element;
        const cm = cmContainer.CodeMirror;
        
        if (cm) {
          cm.setValue(code);
          cm.focus();
          return true;
        }
      }
      
      // Monaco Editor handling
      if (element.className.includes('monaco') || element.closest('.monaco-editor')) {
        if (window.monaco && window.monaco.editor) {
          const editors = window.monaco.editor.getEditors();
          const editor = editors.find(e => 
            e.getDomNode().contains(element) || element.contains(e.getDomNode())
          );
          
          if (editor) {
            editor.setValue(code);
            editor.focus();
            return true;
          }
        }
      }
      
      // Ace Editor handling
      if (element.className.includes('ace_editor')) {
        if (window.ace) {
          const editor = window.ace.edit(element.id || element);
          if (editor) {
            editor.setValue(code, -1);
            editor.focus();
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  function isCodeEditor(element) {
    const codeEditorClasses = [
      'CodeMirror', 'monaco', 'ace_editor', 'cm-editor', 
      'codemirror', 'code-editor', 'editor'
    ];
    
    return codeEditorClasses.some(cls => 
      element.className.toLowerCase().includes(cls.toLowerCase())
    ) || element.id.toLowerCase().includes('editor') ||
       element.closest('.CodeMirror') || element.closest('.monaco-editor');
  }

  async function executeAction(action) {
    try {
      switch (action.action.toLowerCase()) {
        case 'type':
          // Simply type at current cursor position without finding elements
          const typingSuccess = await typeAtCurrentPosition(action.value);
          if (!typingSuccess) {
            return false;
          }
          break;

        case 'click':
          // Find the element for clicking
          const element = findClickableElement(action.elementId, action.value);
          
          if (!element) {
            return false;
          }

          // Check if element is visible and enabled
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            // Element appears to be hidden
          }

          if (element.disabled) {
            return false;
          }

          // Scroll to element smoothly
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(randomDelay(300, 600));

          // Highlight element for debugging
          const originalOutline = element.style.outline;
          element.style.outline = '3px solid red';
          await sleep(200);
          element.style.outline = originalOutline;
          
          // For options in select, change selection instead of clicking
          if (element.tagName.toLowerCase() === 'option') {
            const select = element.closest('select');
            if (select) {
              select.value = element.value;
              element.selected = true;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
          
          const rect2 = element.getBoundingClientRect();
          const x = rect2.left + rect2.width / 2 + (Math.random() - 0.5) * 10;
          const y = rect2.top + rect2.height / 2 + (Math.random() - 0.5) * 10;
          
          // Comprehensive click simulation
          element.dispatchEvent(new MouseEvent('mouseover', { 
            clientX: x, clientY: y, bubbles: true, cancelable: true 
          }));
          await sleep(50);
          
          element.dispatchEvent(new MouseEvent('mousedown', { 
            clientX: x, clientY: y, bubbles: true, cancelable: true 
          }));
          await sleep(randomDelay(50, 150));
          
          element.dispatchEvent(new MouseEvent('mouseup', { 
            clientX: x, clientY: y, bubbles: true, cancelable: true 
          }));
          
          element.dispatchEvent(new MouseEvent('click', { 
            clientX: x, clientY: y, bubbles: true, cancelable: true 
          }));
          
          // Handle special input types
          if (element.type === 'radio') {
            element.checked = true;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (element.type === 'checkbox') {
            element.checked = !element.checked;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          element.focus();
          await sleep(100);
          
          break;

        case 'select':
          const selectElement = findClickableElement(action.elementId, action.value);
          
          if (!selectElement) {
            return false;
          }
          
          if (selectElement.tagName.toLowerCase() === 'select') {
            // Find the option by value or text
            const option = Array.from(selectElement.options).find(opt => 
              opt.value === action.value || 
              opt.text === action.value ||
              opt.text.toLowerCase().includes(action.value.toLowerCase()) ||
              action.value.toLowerCase().includes(opt.text.toLowerCase())
            );
            
            if (option) {
              selectElement.value = option.value;
              option.selected = true;
            } else {
              selectElement.value = action.value;
            }
            
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            selectElement.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            return false;
          }
          break;

        default:
          return false;
      }

      await sleep(randomDelay(200, 500));
      return true;

    } catch (error) {
      return false;
    }
  }

  // Execute all actions sequentially
  return (async () => {
    const results = [];
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const success = await executeAction(action);
      results.push(success);
      
      // Wait between actions
      await sleep(randomDelay(400, 800));
    }
    
    return results;
  })();
}

// Enhanced AI prompt for better accuracy with tab handling
function createPrompt(pageData) {
  return `You are an expert web automation AI. Analyze this webpage and provide ONLY the most accurate actions to take.

CRITICAL REQUIREMENTS:
1. For coding problems: Write clean, optimal, working code that solves the exact problem
   - Use proper indentation with TAB characters (\t) for each indentation level
   - Maintain consistent code formatting and structure
   - Preserve original indentation patterns when applicable
2. For quizzes/questions: Provide the EXACT TEXT of the correct answer as it appears on the page
3. For forms: Fill with appropriate, realistic data
4. For multiple choice: Provide the EXACT TEXT of the best answer option
5. Use exact element IDs from the provided list
6. For answers, provide the exact text that should be clicked/selected

PAGE: ${pageData.title}
URL: ${pageData.url}

CONTENT:
${pageData.pageContent}

INTERACTIVE ELEMENTS:
${pageData.interactiveElements.map((el, i) => 
  `${i + 1}. ID: "${el.id}" | Type: ${el.type} | Tag: ${el.tagName} | Label: "${el.label}" | Text: "${el.text || el.value || ''}" | Placeholder: "${el.placeholder}"${el.options ? ` | Options: [${el.options.map(o => `"${o.text}"`).join(', ')}]` : ''}${el.inputType ? ` | InputType: ${el.inputType}` : ''}${el.isCodeEditor ? ' | CodeEditor: true' : ''}`
).join('\n')}

INSTRUCTIONS:
- Analyze the page content carefully for context clues
- For coding challenges: Write complete, working solutions with proper tab indentation
- For quizzes: Provide EXACT answer text that appears in the options
- For multiple choice: Use the EXACT option text, not paraphrases
- Use exact element IDs from the list above
- Provide minimal necessary actions to complete the task
- When writing code, use \\t characters for proper indentation (will be converted to appropriate spacing)

Respond with this JSON structure (and ONLY this JSON, no extra text):
{
  "actions": [
    {
      "elementId": "exact_element_id_from_list",
      "action": "type|click|select",
      "value": "exact_content_or_answer_text"
    }
  ]
}`;
}

// Main command handlers
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    return;
  }

  try {
    if (command === "copycat_copy") {
      // Inject tracking script first
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: trackInteractions
      });
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePageData
      });
      
      const pageData = results[0]?.result;
      if (!pageData) {
        return;
      }
      
      // Get AI analysis
      const settings = await chrome.storage.local.get(['copycat_api_key', 'copycat_model']);
      
      if (!settings.copycat_api_key) {
        return;
      }

      const prompt = createPrompt(pageData);
      
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${settings.copycat_api_key}`
        },
        body: JSON.stringify({
          model: settings.copycat_model || "llama-3.1-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are a web automation expert. Analyze web pages and provide accurate actions as clean JSON. Your response must contain valid JSON with an 'actions' array. You may include reasoning before the JSON, but ensure the JSON is clearly formatted and parseable. For code, use proper indentation with tab characters (\\t) for each level of indentation."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const aiResponse = data.choices[0]?.message?.content;

      if (!aiResponse) {
        return;
      }

      // Enhanced JSON extraction to handle thinking models
      lastAIResponse = extractJSONFromResponse(aiResponse);
      
      if (!lastAIResponse || !lastAIResponse.actions) {
        return;
      }

      // Validate and clean actions
      lastAIResponse.actions = lastAIResponse.actions.filter(action => 
        action.elementId && action.action && 
        ['type', 'click', 'select'].includes(action.action.toLowerCase()) &&
        action.value !== undefined
      );
      
      if (lastAIResponse.actions.length === 0) {
        return;
      }
    }
    
    if (command === "copycat_paste") {
      if (!lastAIResponse || !lastAIResponse.actions || lastAIResponse.actions.length === 0) {
        return;
      }
      
      // Execute actions with proper tab handling
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: executeActions,
        args: [lastAIResponse.actions]
      });
    }
    
  } catch (error) {
    // Silent error handling
  }
});

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Set default settings
  chrome.storage.local.get(['copycat_api_key', 'copycat_model'], (result) => {
    if (!result.copycat_model) {
      chrome.storage.local.set({ copycat_model: 'llama-3.1-70b-versatile' });
    }
  });
});
