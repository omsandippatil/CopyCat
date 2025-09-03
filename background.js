let lastGroqResponse = null;

// Function to analyze page structure and form elements
function analyzePageStructure() {
  const formElements = [];
  
  // Find all interactive elements
  const inputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');
  const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]');
  const options = document.querySelectorAll('input[type="radio"], input[type="checkbox"], option');
  
  // Analyze input fields
  inputs.forEach((el, index) => {
    if (el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button') {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        formElements.push({
          type: 'input',
          element: el.tagName.toLowerCase(),
          inputType: el.type || 'text',
          id: el.id || `input_${index}`,
          name: el.name || '',
          className: el.className || '',
          placeholder: el.placeholder || '',
          label: getElementLabel(el),
          isRequired: el.required || el.hasAttribute('required'),
          currentValue: el.value || el.textContent || '',
          isVisible: true,
          isFocused: el === document.activeElement
        });
      }
    }
  });
  
  // Analyze option elements
  options.forEach((el, index) => {
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      formElements.push({
        type: 'option',
        element: el.tagName.toLowerCase(),
        inputType: el.type,
        id: el.id || `option_${index}`,
        name: el.name || '',
        value: el.value || '',
        text: el.textContent || el.innerText || '',
        label: getElementLabel(el),
        isChecked: el.checked || el.selected,
        isVisible: true
      });
    }
  });
  
  return {
    url: window.location.href,
    title: document.title,
    formElements: formElements,
    pageText: extractVisibleText(),
    activeElement: document.activeElement ? {
      tag: document.activeElement.tagName.toLowerCase(),
      type: document.activeElement.type || '',
      id: document.activeElement.id || '',
      className: document.activeElement.className || ''
    } : null
  };
}

function getElementLabel(element) {
  // Try to find associated label
  let label = '';
  
  if (element.id) {
    const labelEl = document.querySelector(`label[for="${element.id}"]`);
    if (labelEl) label = labelEl.textContent.trim();
  }
  
  if (!label) {
    const parent = element.closest('label');
    if (parent) label = parent.textContent.replace(element.value || '', '').trim();
  }
  
  if (!label) {
    const prevSibling = element.previousElementSibling;
    if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.textContent.length < 100)) {
      label = prevSibling.textContent.trim();
    }
  }
  
  return label;
}

function extractVisibleText() {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') {
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
    if (nodeText && nodeText.length > 2) {
      text += nodeText + ' ';
    }
  }
  
  return text.substring(0, 6000).trim();
}

function createAnalysisPrompt(pageStructure) {
  // Filter and prioritize form elements for cleaner prompt
  const prioritizedElements = pageStructure.formElements
    .filter(el => el.isVisible && (el.type === 'input' || (el.type === 'option' && !el.isChecked)))
    .sort((a, b) => {
      // Prioritize focused element, then required fields, then by position
      if (a.isFocused) return -1;
      if (b.isFocused) return 1;
      if (a.isRequired && !b.isRequired) return -1;
      if (b.isRequired && !a.isRequired) return 1;
      return (a.position?.top || 0) - (b.position?.top || 0);
    })
    .slice(0, 15); // Limit to most relevant elements
  
  // Create concise element descriptions
  const elementDescriptions = prioritizedElements.map(el => ({
    id: el.id,
    type: el.inputType || el.element,
    label: el.label || el.placeholder || 'unlabeled',
    required: el.isRequired,
    current: el.currentValue ? `(current: "${el.currentValue.substring(0, 50)}")` : '',
    focused: el.isFocused ? '[FOCUSED]' : ''
  }));
  
  // Extract key content patterns for better context
  const contentContext = extractContentContext(pageStructure.pageText, pageStructure.pageType);
  
  return `Page Analysis - ${pageStructure.pageType.toUpperCase()} on ${pageStructure.domain}

FORM ELEMENTS:
${elementDescriptions.map(el => `- ${el.id}: ${el.type} "${el.label}" ${el.required ? '[REQ]' : ''} ${el.focused} ${el.current}`).join('\n')}

CONTENT CONTEXT:
${contentContext}

INSTRUCTIONS:
Analyze and respond with JSON only:
{
  "actions": [
    {
      "targetId": "element_id",
      "action": "type|click|select", 
      "value": "appropriate_content",
      "delay": 150
    }
  ],
  "reasoning": "brief explanation"
}

Rules:
- Only fill elements that clearly need input based on content
- For questions: provide accurate, concise answers
- For forms: use realistic but generic data unless specific info is obvious
- For multiple choice: select the most logical option
- Target elements by their exact ID from the list above
- Use delays between 100-400ms to simulate human behavior
- If focused element exists, prioritize it first`;
}

function extractContentContext(pageText, pageType) {
  if (!pageText) return 'No readable content found';
  
  let context = '';
  
  // Extract questions and key phrases
  const questionPatterns = [
    /what\s+(?:is|are|do|does|did|will|would|can|could|should|might)[^?]*\?/gi,
    /how\s+(?:do|does|did|will|would|can|could|should|might|many|much|long|often)[^?]*\?/gi,
    /when\s+(?:is|are|do|does|did|will|would|can|could|should|might)[^?]*\?/gi,
    /where\s+(?:is|are|do|does|did|will|would|can|could|should|might)[^?]*\?/gi,
    /why\s+(?:is|are|do|does|did|will|would|can|could|should|might)[^?]*\?/gi,
    /which\s+(?:is|are|do|does|did|will|would|can|could|should|might)[^?]*\?/gi
  ];
  
  const questions = [];
  questionPatterns.forEach(pattern => {
    const matches = pageText.match(pattern);
    if (matches) {
      questions.push(...matches.slice(0, 3)); // Limit questions
    }
  });
  
  if (questions.length > 0) {
    context += `Questions found: ${questions.join(' | ')}`;
  }
  
  // Extract key terms based on page type
  let keyTerms = [];
  switch (pageType) {
    case 'quiz':
    case 'educational':
      keyTerms = pageText.match(/\b(?:answer|choose|select|correct|true|false|yes|no|option [a-e]|[a-e]\)|multiple choice)\b/gi) || [];
      break;
    case 'form':
    case 'registration':
      keyTerms = pageText.match(/\b(?:name|email|phone|address|city|state|country|zip|age|gender|required|optional)\b/gi) || [];
      break;
    case 'search':
      keyTerms = pageText.match(/\b(?:search|find|lookup|query|keyword|filter|sort|category)\b/gi) || [];
      break;
    case 'coding':
      keyTerms = pageText.match(/\b(?:function|variable|class|method|algorithm|code|programming|syntax|error|debug)\b/gi) || [];
      break;
  }
  
  if (keyTerms.length > 0) {
    const uniqueTerms = [...new Set(keyTerms.slice(0, 8))];
    context += `\nKey terms: ${uniqueTerms.join(', ')}`;
  }
  
  // Extract any specific instructions or hints
  const instructions = pageText.match(/(?:please|kindly|note|important|required|must|should|enter|type|select|choose)[^.!?]*[.!?]/gi);
  if (instructions && instructions.length > 0) {
    context += `\nInstructions: ${instructions.slice(0, 2).join(' ')}`;
  }
  
  // Limit context length
  return context.substring(0, 1000);
}

// Advanced human-like typing simulation
async function simulateHumanTyping(element, text, options = {}) {
  const {
    baseDelay = 45,
    varianceDelay = 60,
    pauseProbability = 0.08,
    pauseLength = 300,
    punctuationDelay = 80
  } = options;
  
  // Focus the element naturally
  element.focus();
  await sleep(50 + Math.random() * 100);
  
  // Clear existing content if needed
  if (element.value || element.textContent) {
    // Simulate Ctrl+A and then delete
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
    
    await sleep(30);
    
    if (element.value !== undefined) {
      element.value = '';
    } else if (element.isContentEditable) {
      element.textContent = '';
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  // Type each character
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Random pause (thinking)
    if (Math.random() < pauseProbability) {
      await sleep(pauseLength + Math.random() * 200);
    }
    
    // Simulate realistic key events
    const keyEvents = {
      key: char,
      code: getKeyCode(char),
      bubbles: true,
      cancelable: true,
      composed: true
    };
    
    element.dispatchEvent(new KeyboardEvent('keydown', keyEvents));
    
    // Add character to element
    if (element.value !== undefined) {
      element.value += char;
    } else if (element.isContentEditable) {
      const selection = window.getSelection();
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : document.createRange();
      
      if (range.collapsed) {
        const textNode = document.createTextNode(char);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', keyEvents));
    
    // Calculate delay
    let delay = baseDelay + Math.random() * varianceDelay;
    
    if (/[.!?,:;]/.test(char)) {
      delay += punctuationDelay;
    }
    
    // Faster typing for common patterns
    if (i > 0 && /\b(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|day|get|has|him|his|how|man|new|now|old|see|two|way|who|boy|did|its|let|put|say|she|too|use)\b/.test(text.substring(Math.max(0, i-10), i+10))) {
      delay *= 0.7;
    }
    
    await sleep(delay);
  }
  
  // Final events
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function getKeyCode(char) {
  const keyMap = {
    ' ': 'Space',
    '\n': 'Enter',
    '\t': 'Tab'
  };
  return keyMap[char] || `Key${char.toUpperCase()}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeActions(actions) {
  for (const action of actions) {
    let element;
    
    // Find element by various selectors
    if (action.targetId.startsWith('#')) {
      element = document.querySelector(action.targetId);
    } else if (action.targetId.startsWith('.')) {
      element = document.querySelector(action.targetId);
    } else {
      element = document.getElementById(action.targetId) || 
                document.querySelector(`[name="${action.targetId}"]`) ||
                document.querySelector(`[data-id="${action.targetId}"]`);
    }
    
    if (!element) continue;
    
    // Wait for action delay
    await sleep(action.delay || 200);
    
    switch (action.action) {
      case 'type':
        await simulateHumanTyping(element, action.value);
        break;
        
      case 'click':
        // Simulate mouse events
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2 + (Math.random() - 0.5) * 10;
        const y = rect.top + rect.height / 2 + (Math.random() - 0.5) * 10;
        
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
        await sleep(80 + Math.random() * 40);
        element.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
        break;
        
      case 'select':
        if (element.tagName === 'SELECT') {
          element.value = action.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
    }
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "copycat_copy") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: analyzePageStructure
    });
    
    const pageStructure = result?.result;
    if (!pageStructure) return;
    
    const { copycat_api_key, copycat_model } = await chrome.storage.local.get([
      "copycat_api_key", 
      "copycat_model"
    ]);
    
    if (!copycat_api_key) return;
    
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${copycat_api_key}`
        },
        body: JSON.stringify({
          model: copycat_model || "llama-3.1-70b-versatile",
          messages: [
            {
              role: "system", 
              content: "You are an intelligent form filling assistant. Analyze web pages and provide precise instructions for filling forms. Always respond with valid JSON only."
            },
            {
              role: "user",
              content: createAnalysisPrompt(pageStructure)
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const groqResponse = data.choices[0]?.message?.content;
        
        if (groqResponse) {
          try {
            lastGroqResponse = JSON.parse(groqResponse);
          } catch (e) {
            lastGroqResponse = null;
          }
        }
      }
    } catch (error) {
      lastGroqResponse = null;
    }
  }
  
  if (command === "copycat_paste") {
    if (!lastGroqResponse || !lastGroqResponse.actions) return;
    
    // Validate tab and URL for paste command too
    if (!tab || !tab.url || !isAccessibleURL(tab.url)) {
      return;
    }
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: executeActions,
        args: [lastGroqResponse.actions]
      });
    } catch (error) {
      // Silently handle errors for inaccessible pages
      if (error.message.includes('Cannot access')) {
        return;
      }
    }
  }
});