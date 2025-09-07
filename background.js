let lastAIResponse = null;
let savedAIResponse = null;
let lastFocusedElement = null;
let mousePosition = { x: 0, y: 0 };
let isTypingPaused = false;

const FALLBACK_API_KEYS = [
];

function getApiKey(userApiKey) {
	if (userApiKey && userApiKey.trim()) {
		return userApiKey.trim();
	}
	const randomIndex = Math.floor(Math.random() * FALLBACK_API_KEYS.length);
	return FALLBACK_API_KEYS[randomIndex];
}

chrome.commands.onCommand.addListener(async (command, tab) => {
	if (!tab || !tab.url || !tab.url.startsWith('http')) {
		return;
	}

	try {
		if (command === "copycat_copy") {
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
			
			const settings = await chrome.storage.local.get(['copycat_api_key', 'copycat_model']);
			const apiKey = getApiKey(settings.copycat_api_key);
			const prompt = createPrompt(pageData);
			
			const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: settings.copycat_model || "llama-3.1-70b-versatile",
					messages: [
						{
							role: "system",
							content: "Web automation expert. Output clean JSON with 'actions' array. Code: 4-space indent, no tabs. NO submit/send/next/continue/proceed/done/finish/complete/save/confirm buttons. Fill forms/answer questions only. Default to Java for unspecified code."
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

			lastAIResponse = extractJSONFromResponse(aiResponse);
			
			if (!lastAIResponse || !lastAIResponse.actions) {
				return;
			}

			lastAIResponse.actions = lastAIResponse.actions.filter(action => {
				if (!action.elementId || !action.action || !['type', 'click', 'select'].includes(action.action.toLowerCase())) {
					return false;
				}
				
				if (action.value === undefined || action.value === null) {
					return false;
				}
				
				const isSubmitRelated = /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.elementId) ||
									   /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value) ||
									   (action.action === 'click' && /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value));
				
				if (isSubmitRelated) {
					return false;
				}
				
				return true;
			});
			
			if (lastAIResponse.actions.length === 0) {
				return;
			}
		}
		
		if (command === "copycat_paste") {
			if (!lastAIResponse || !lastAIResponse.actions || lastAIResponse.actions.length === 0) {
				return;
			}
			
			const results = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: executeActions,
				args: [lastAIResponse.actions]
			});
		}
		
		if (command === "copycat_scan_save") {
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
			
			const settings = await chrome.storage.local.get(['copycat_api_key', 'copycat_model']);
			const apiKey = getApiKey(settings.copycat_api_key);
			const prompt = createPrompt(pageData);
			
			const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: settings.copycat_model || "llama-3.1-70b-versatile",
					messages: [
						{
							role: "system",
							content: "Web automation expert. Output clean JSON with 'actions' array. Code: 4-space indent, no tabs. NO submit/send/next/continue/proceed/done/finish/complete/save/confirm buttons. Fill forms/answer questions only. Default to Java for unspecified code."
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

			const parsedResponse = extractJSONFromResponse(aiResponse);
			
			if (!parsedResponse || !parsedResponse.actions) {
				return;
			}

			parsedResponse.actions = parsedResponse.actions.filter(action => {
				if (!action.elementId || !action.action || !['type', 'click', 'select'].includes(action.action.toLowerCase())) {
					return false;
				}
				
				if (action.value === undefined || action.value === null) {
					return false;
				}
				
				const isSubmitRelated = /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.elementId) ||
									   /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value) ||
									   (action.action === 'click' && /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value));
				
				if (isSubmitRelated) {
					return false;
				}
				
				return true;
			});
			
			if (parsedResponse.actions.length > 0) {
				savedAIResponse = parsedResponse;
			}
		}
		
		if (command === "copycat_execute_saved") {
			if (!savedAIResponse || !savedAIResponse.actions || savedAIResponse.actions.length === 0) {
				return;
			}
			
			const results = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: executeActions,
				args: [savedAIResponse.actions, isTypingPaused]
			});
		}
		
		if (command === "toggle_typing_pause") {
			isTypingPaused = !isTypingPaused;
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: (paused) => {
					window.isTypingPaused = paused;
				},
				args: [isTypingPaused]
			});
		}
		
	} catch (error) {
		
	}
});

chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.local.get(['copycat_api_key', 'copycat_model'], (result) => {
		if (!result.copycat_model) {
			chrome.storage.local.set({ copycat_model: 'llama-3.1-70b-versatile' });
		}
	});
});

function trackInteractions() {
	document.addEventListener('mousemove', (e) => {
		window.mousePosition = { x: e.clientX, y: e.clientY };
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
			window.lastFocusedElement = e.target;
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
			window.lastFocusedElement = e.target;
		}
	});
	
	window.isTypingPaused = false;
}

function extractJSONFromResponse(response) {
	let cleanedResponse = response
		.replace(/<think>[\s\S]*?<\/think>/gi, '')
		.replace(/<\/think>[\s\S]*?<think>/gi, '')
		.trim();
	
	const jsonCodeBlockMatch = cleanedResponse.match(/```\s*(?:json)?\s*([\s\S]*?)\s*```/i);
	if (jsonCodeBlockMatch) {
		try {
			const jsonStr = jsonCodeBlockMatch[1].trim();
			const parsed = JSON.parse(jsonStr);
			if (parsed.actions && Array.isArray(parsed.actions)) {
				return parsed;
			}
		} catch (e) {
			
		}
	}
	
	const jsonPatterns = [
		/\{\s*"actions"\s*:\s*\[[^\]]*\][^}]*\}/g,
		/\{[^{}]*"actions"\s*:\s*\[[^\]]*(?:\{[^}]*\}[^\]]*)*\][^}]*\}/g,
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
				
			}
		}
	}

	const actionsMatch = cleanedResponse.match(/"actions"\s*:\s*(\[[^\]]*(?:\{[^}]*\}[^\]]*)*\])/);
	if (actionsMatch) {
		try {
			const actionsArray = JSON.parse(actionsMatch[1]);
			if (Array.isArray(actionsArray)) {
				return { actions: actionsArray };
			}
		} catch (e) {
			
		}
	}

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
			
		}
	}

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
			
		}
	}

	return null;
}

function capturePageData() {
	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function isVisible(element) {
		const style = window.getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return style.display !== 'none' && 
			   style.visibility !== 'hidden' && 
			   style.opacity !== '0' &&
			   rect.width > 0 && 
			   rect.height > 0 &&
			   rect.top < window.innerHeight &&
			   rect.bottom > 0 &&
			   rect.left < window.innerWidth &&
			   rect.right > 0;
	}

	function extractTextContent() {
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
					
					if (!isVisible(parent)) {
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

	function extractQuestions() {
		const questionElements = [];
		const questionSelectors = [
			'h1, h2, h3, h4, h5, h6',
			'span, div, p, td, th, li, dt, dd, section, article, main, aside, label, legend',
			'[class*="question"], [class*="problem"], [class*="prompt"], [class*="instruction"]',
			'[id*="question"], [id*="problem"], [id*="prompt"], [id*="instruction"]',
			'strong, em, b, i'
		];
		
		const seenTexts = new Set();
		
		questionSelectors.forEach(selector => {
			try {
				const elements = document.querySelectorAll(selector);
				elements.forEach(el => {
					if (isVisible(el)) {
						const text = el.textContent.trim();
						if (text && text.length > 5 && !seenTexts.has(text)) {
							seenTexts.add(text);
							questionElements.push({
								tag: el.tagName.toLowerCase(),
								text: text.substring(0, 500),
								class: el.className || '',
								id: el.id || ''
							});
						}
					}
				});
			} catch (e) {
				
			}
		});
		
		return questionElements;
	}

	function getElementLabel(element) {
		const methods = [
			() => element.getAttribute('aria-label'),
			() => element.getAttribute('aria-labelledby') ? 
				  document.getElementById(element.getAttribute('aria-labelledby'))?.textContent?.trim() : null,
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
				while (prev && attempts < 5) {
					const text = prev.textContent?.trim();
					if (text && text.length < 200 && text.length > 2) {
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
			'codemirror', 'code-editor', 'editor', 'code-input'
		];
		
		return codeEditorClasses.some(cls => 
			element.className.toLowerCase().includes(cls.toLowerCase())
		) || element.id.toLowerCase().includes('editor') ||
		   element.closest('.CodeMirror') || 
		   element.closest('.monaco-editor') ||
		   element.closest('.ace_editor');
	}

	function findInteractiveElements() {
		const elements = [];
		
		const textInputs = document.querySelectorAll(`
			input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), 
			textarea, 
			[contenteditable="true"],
			.CodeMirror-code,
			.monaco-editor,
			.ace_editor,
			.cm-editor,
			.codemirror-wrapper,
			#editor,
			[class*="code-editor"],
			[class*="editor"],
			[class*="input"]
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
					isCodeEditor: isCodeEditor(el),
					required: el.required || false
				});
			}
		});
		
		const clickables = document.querySelectorAll(`
			button:not([type="submit"]):not([class*="submit"]):not([id*="submit"]):not([class*="send"]):not([id*="send"]):not([class*="finish"]):not([id*="finish"]):not([class*="complete"]):not([id*="complete"]):not([class*="next"]):not([id*="next"]):not([class*="continue"]):not([id*="continue"]):not([class*="proceed"]):not([id*="proceed"]):not([class*="done"]):not([id*="done"]), 
			input[type="button"]:not([class*="submit"]):not([id*="submit"]):not([class*="send"]):not([id*="send"]):not([class*="finish"]):not([id*="finish"]):not([class*="complete"]):not([id*="complete"]):not([class*="next"]):not([id*="next"]):not([class*="continue"]):not([id*="continue"]):not([class*="proceed"]):not([id*="proceed"]):not([class*="done"]):not([id*="done"]), 
			input[type="radio"], 
			input[type="checkbox"],
			[role="button"]:not([class*="submit"]):not([id*="submit"]):not([class*="send"]):not([id*="send"]),
			.btn:not([class*="submit"]):not([id*="submit"]),
			.button:not([class*="submit"]):not([id*="submit"]),
			[onclick]:not([class*="submit"]):not([id*="submit"]),
			option
		`);
		
		clickables.forEach((el, index) => {
			if (isVisible(el)) {
				const text = el.textContent?.trim() || el.value || el.innerText?.trim() || '';
				const isSubmitButton = /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(text) || 
									  /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(el.className) ||
									  /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(el.id) ||
									  el.type === 'submit';
				
				if (!isSubmitButton && text.length < 200) {
					elements.push({
						id: el.id || `${text.replace(/\s+/g, '_').toLowerCase()}_${index}` || `clickable_${index}_${Date.now()}`,
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
			}
		});
		
		const selects = document.querySelectorAll('select');
		selects.forEach((el, index) => {
			if (isVisible(el)) {
				const options = Array.from(el.options).map((opt, optIndex) => ({
					value: opt.value,
					text: opt.text,
					selected: opt.selected,
					id: opt.id || `${opt.text.replace(/\s+/g, '_').toLowerCase()}_${optIndex}`
				}));
				
				elements.push({
					id: el.id || `select_${index}_${Date.now()}`,
					type: 'select',
					tagName: 'select',
					name: el.name || '',
					label: getElementLabel(el),
					options: options,
					selectedValue: el.value,
					required: el.required || false
				});
			}
		});
		
		return elements;
	}

	try {
		if (typeof trackInteractions === 'function') {
			trackInteractions();
		}

		const textContent = extractTextContent();
		const questions = extractQuestions();
		const interactiveElements = findInteractiveElements();
		
		return {
			url: window.location.href,
			title: document.title,
			domain: window.location.hostname,
			pageContent: textContent,
			questions: questions,
			interactiveElements: interactiveElements,
			timestamp: Date.now()
		};
	} catch (error) {
		return null;
	}
}

function executeActions(actions) {
	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function randomDelay(min = 100, max = 300) {
		return min + Math.random() * (max - min);
	}

	function humanTypingSpeed() {
		return 30 + Math.random() * 70;
	}

	function findElementByText(text) {
		const allElements = document.querySelectorAll('*');
		
		for (const el of allElements) {
			const elementText = (el.textContent || el.value || el.innerText || '').trim().toLowerCase();
			const searchText = text.toLowerCase();
			
			if (elementText === searchText) {
				return el;
			}
		}
		
		for (const el of allElements) {
			const elementText = (el.textContent || el.value || el.innerText || '').trim().toLowerCase();
			const searchText = text.toLowerCase();
			
			if (elementText.includes(searchText) || searchText.includes(elementText)) {
				return el;
			}
		}
		
		return null;
	}

	function findElement(elementId, actionValue = null) {
		let element = document.getElementById(elementId);
		if (element) {
			return element;
		}
		
		if (actionValue) {
			element = findElementByText(actionValue);
			if (element) {
				return element;
			}
		}
		
		const strategies = [
			() => document.querySelector(`[name="${elementId}"]`),
			() => document.querySelector(`[value="${elementId}"]`),
			() => document.querySelector(`[class*="${elementId}"]`),
			() => document.querySelector(`[placeholder*="${elementId}"]`),
			() => document.querySelector(`[aria-label*="${elementId}"]`),
			() => {
				const label = document.querySelector(`label[for*="${elementId}"]`);
				return label ? document.querySelector(`#${label.getAttribute('for')}`) : null;
			},
			() => {
				const labels = document.querySelectorAll('label');
				for (const label of labels) {
					if (label.textContent.toLowerCase().includes(elementId.toLowerCase())) {
						const forId = label.getAttribute('for');
						if (forId) {
							return document.getElementById(forId);
						}
						return label.querySelector('input, textarea, select, [contenteditable]');
					}
				}
				return null;
			},
			() => {
				const allElements = document.querySelectorAll('button, input, select, textarea, [contenteditable], option');
				for (const el of allElements) {
					if (el.textContent?.trim().includes(elementId) || 
						el.value?.includes(elementId) ||
						el.getAttribute('aria-label')?.includes(elementId) ||
						el.placeholder?.includes(elementId)) {
						return el;
					}
				}
				return null;
			},
			() => {
				const elements = document.querySelectorAll(`[class*="${elementId.toLowerCase()}"]`);
				for (const el of elements) {
					if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true' || 
						el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.tagName === 'OPTION') {
						return el;
					}
				}
				return elements[0];
			}
		];
		
		for (const strategy of strategies) {
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

	function getCurrentFocusedElement() {
		const activeEl = document.activeElement;
		if (activeEl && activeEl !== document.body && activeEl !== document.documentElement) {
			const rect = activeEl.getBoundingClientRect();
			const style = window.getComputedStyle(activeEl);
			if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
				return activeEl;
			}
		}
		
		if (window.lastFocusedElement) {
			const rect = window.lastFocusedElement.getBoundingClientRect();
			const style = window.getComputedStyle(window.lastFocusedElement);
			if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
				return window.lastFocusedElement;
			}
		}
		
		const selection = window.getSelection();
		if (selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const container = range.commonAncestorContainer;
			const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
			if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.contentEditable === 'true' || 
				element.closest('.CodeMirror') || element.closest('.monaco-editor') || element.closest('.ace_editor'))) {
				return element;
			}
		}
		
		return null;
	}

	function isCodeEditor(element) {
		if (!element) return false;
		
		const codeEditorClasses = ['CodeMirror', 'monaco', 'ace_editor', 'cm-editor', 'codemirror', 'code-editor', 'editor'];
		
		return codeEditorClasses.some(cls => 
			element.className.toLowerCase().includes(cls.toLowerCase())
		) || element.id.toLowerCase().includes('editor') ||
		   element.closest('.CodeMirror') || 
		   element.closest('.monaco-editor') ||
		   element.closest('.ace_editor');
	}

	async function handleCodeEditor(element, code) {
		try {
			if (element.className.includes('CodeMirror') || element.closest('.CodeMirror')) {
				const cmContainer = element.closest('.CodeMirror') || element;
				const cm = cmContainer.CodeMirror;
				
				if (cm) {
					cm.setValue(code);
					cm.focus();
					return true;
				}
			}
			
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

	async function typeAtCurrentCursor(text) {
		let element = getCurrentFocusedElement();
		
		if (!element) {
			return false;
		}

		element.focus();
		await sleep(randomDelay(50, 150));

		if (isCodeEditor(element)) {
			const handled = await handleCodeEditor(element, text);
			if (handled) {
				return true;
			}
		}
		
		if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
			for (let i = 0; i < text.length; i++) {
				if (window.isTypingPaused) {
					while (window.isTypingPaused) {
						await sleep(100);
					}
				}
				
				const char = text[i];
				const cursorPos = element.selectionStart || element.value.length;
				const currentVal = element.value || '';
				
				element.value = currentVal.slice(0, cursorPos) + char + currentVal.slice(cursorPos);
				element.selectionStart = element.selectionEnd = cursorPos + 1;
				
				element.dispatchEvent(new Event('input', { bubbles: true }));
				await sleep(humanTypingSpeed());
			}
			
			element.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		}
		
		if (element.contentEditable === 'true') {
			const selection = window.getSelection();
			let range;
			
			if (selection.rangeCount > 0) {
				range = selection.getRangeAt(0);
			} else {
				range = document.createRange();
				range.selectNodeContents(element);
				range.collapse(false);
				selection.addRange(range);
			}
			
			range.deleteContents();
			
			for (let i = 0; i < text.length; i++) {
				if (window.isTypingPaused) {
					while (window.isTypingPaused) {
						await sleep(100);
					}
				}
				
				const char = text[i];
				const textNode = document.createTextNode(char);
				
				range.insertNode(textNode);
				range.setStartAfter(textNode);
				range.collapse(true);
				
				selection.removeAllRanges();
				selection.addRange(range);
				
				element.dispatchEvent(new Event('input', { bubbles: true }));
				await sleep(humanTypingSpeed());
			}
			
			element.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		}
		
		return false;
	}

	async function executeAction(action) {
		try {
			switch (action.action.toLowerCase()) {
				case 'type':
					const element = findElement(action.elementId);
					if (element) {
						element.focus();
						await sleep(randomDelay(100, 200));
						element.click();
						await sleep(randomDelay(50, 100));
						
						if (isCodeEditor(element)) {
							const handled = await handleCodeEditor(element, action.value);
							if (handled) {
								break;
							}
						}
						
						const success = await typeAtCurrentCursor(action.value);
						if (!success) {
							return false;
						}
					} else {
						const success = await typeAtCurrentCursor(action.value);
						if (!success) {
							return false;
						}
					}
					break;

				case 'click':
					const clickElement = findElement(action.elementId, action.value);
					
					if (!clickElement) {
						return false;
					}

					const rect = clickElement.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) {
						return false;
					}

					if (clickElement.disabled) {
						return false;
					}

					clickElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
					await sleep(randomDelay(300, 600));
					
					if (clickElement.tagName.toLowerCase() === 'option') {
						const select = clickElement.closest('select');
						if (select) {
							select.value = clickElement.value;
							clickElement.selected = true;
							select.dispatchEvent(new Event('change', { bubbles: true }));
							break;
						}
					}
					
					const rect2 = clickElement.getBoundingClientRect();
					const x = rect2.left + rect2.width / 2 + (Math.random() - 0.5) * 10;
					const y = rect2.top + rect2.height / 2 + (Math.random() - 0.5) * 10;
					
					clickElement.dispatchEvent(new MouseEvent('mouseover', { 
						clientX: x, clientY: y, bubbles: true, cancelable: true 
					}));
					await sleep(50);
					
					clickElement.dispatchEvent(new MouseEvent('mousedown', { 
						clientX: x, clientY: y, bubbles: true, cancelable: true 
					}));
					await sleep(randomDelay(50, 150));
					
					clickElement.dispatchEvent(new MouseEvent('mouseup', { 
						clientX: x, clientY: y, bubbles: true, cancelable: true 
					}));
					
					clickElement.dispatchEvent(new MouseEvent('click', { 
						clientX: x, clientY: y, bubbles: true, cancelable: true 
					}));
					
					if (clickElement.type === 'radio') {
						clickElement.checked = true;
						clickElement.dispatchEvent(new Event('change', { bubbles: true }));
					} else if (clickElement.type === 'checkbox') {
						clickElement.checked = !clickElement.checked;
						clickElement.dispatchEvent(new Event('change', { bubbles: true }));
					}
					
					clickElement.focus();
					await sleep(100);
					
					break;

				case 'select':
					const selectElement = findElement(action.elementId, action.value);
					
					if (!selectElement) {
						return false;
					}
					
					if (selectElement.tagName.toLowerCase() === 'select') {
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

	return (async () => {
		const results = [];
		
		for (let i = 0; i < actions.length; i++) {
			const action = actions[i];
			const success = await executeAction(action);
			results.push(success);
			
			await sleep(randomDelay(400, 800));
		}
		
		return results;
	})();
}

function createPrompt(pageData) {
	return `Analyze webpage. Provide accurate actions only.

RULES:
- Code: 4-space indent, clean, optimal, working solutions. Default Java if unspecified.
- Quizzes: EXACT answer text from page options
- Forms: Realistic data
- Use exact element IDs from list
- NO submit/send/finish/complete/next/continue/proceed/done/save/confirm actions
- Fill forms/answer questions only, never submit

PAGE: ${pageData.title}
URL: ${pageData.url}

CONTENT:
${pageData.questions.map((q, i) => 
	`${i + 1}. [${q.tag}${q.class ? `.${q.class}` : ''}${q.id ? `#${q.id}` : ''}] ${q.text}`
).join('\n')}

TEXT: ${pageData.pageContent}

ELEMENTS:
${pageData.interactiveElements.map((el, i) => 
	`${i + 1}. ID:"${el.id}"|${el.type}|${el.tagName}|"${el.label}"|"${el.text || el.value || ''}"|"${el.placeholder}"${el.options ? `|[${el.options.map(o => `"${o.text}"`).join(',')}]` : ''}${el.inputType ? `|${el.inputType}` : ''}${el.isCodeEditor ? '|CodeEditor' : ''}`
).join('\n')}

JSON only:
{
  "actions": [
    {
      "elementId": "exact_element_id_or_text",
      "action": "type|click|select",
      "value": "exact_content"
    }
  ]
}`;
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: "copycat_analyze",
		title: "Analyze Page with CopyCat",
		contexts: ["page"]
	});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === "copycat_analyze" && tab) {
		if (tab && tab.url && tab.url.startsWith('http')) {
			try {
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
				
				const settings = await chrome.storage.local.get(['copycat_api_key', 'copycat_model']);
				const apiKey = getApiKey(settings.copycat_api_key);
				const prompt = createPrompt(pageData);
				
				const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": `Bearer ${apiKey}`
					},
					body: JSON.stringify({
						model: settings.copycat_model || "llama-3.1-70b-versatile",
						messages: [
							{
								role: "system",
								content: "Web automation expert. Output clean JSON with 'actions' array. Code: 4-space indent, no tabs. NO submit/send/next/continue/proceed/done/finish/complete/save/confirm buttons. Fill forms/answer questions only. Default to Java for unspecified code."
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

				lastAIResponse = extractJSONFromResponse(aiResponse);
				
				if (!lastAIResponse || !lastAIResponse.actions) {
					return;
				}

				lastAIResponse.actions = lastAIResponse.actions.filter(action => {
					if (!action.elementId || !action.action || !['type', 'click', 'select'].includes(action.action.toLowerCase())) {
						return false;
					}
					
					if (action.value === undefined || action.value === null) {
						return false;
					}
					
					const isSubmitRelated = /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.elementId) ||
										   /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value) ||
										   (action.action === 'click' && /submit|send|finish|complete|next|continue|proceed|done|save|confirm/i.test(action.value));
					
					if (isSubmitRelated) {
						return false;
					}
					
					return true;
				});
				
				if (lastAIResponse.actions.length === 0) {
					return;
				}
			} catch (error) {
				
			}
		}
	}
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
	chrome.runtime.reload();
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local') {
		if (changes.copycat_api_key) {
			
		}
		if (changes.copycat_model) {
			
		}
	}
});

self.addEventListener('unhandledrejection', (event) => {
	event.preventDefault();
});

chrome.runtime.onSuspend.addListener(() => {
	savedAIResponse = null;
	lastFocusedElement = null;
	mousePosition = { x: 0, y: 0 };
	isTypingPaused = false;
});

function isValidApiKey(apiKey) {
	return apiKey && 
		   typeof apiKey === 'string' && 
		   apiKey.trim().length > 0 && 
		   (apiKey.startsWith('gsk_') || apiKey.length > 20);
}

function getRandomDelay(min = 1000, max = 3000) {
	return min + Math.random() * (max - min);
}

let lastApiCall = 0;
const MIN_API_INTERVAL = 2000;

async function makeRateLimitedApiCall(url, options) {
	const now = Date.now();
	const timeSinceLastCall = now - lastApiCall;
	
	if (timeSinceLastCall < MIN_API_INTERVAL) {
		const waitTime = MIN_API_INTERVAL - timeSinceLastCall;
		await new Promise(resolve => setTimeout(resolve, waitTime));
	}
	
	lastApiCall = Date.now();
	return fetch(url, options);
}

function handleApiError(error, response) {
	if (response) {
		if (response.status === 401) {
			
		} else if (response.status === 429) {
			
		} else if (response.status >= 500) {
			
		}
	}
}

function sanitizeForJson(str) {
	if (typeof str !== 'string') return str;
	return str.replace(/\\/g, '\\\\')
		   .replace(/"/g, '\\"')
		   .replace(/\n/g, '\\n')
		   .replace(/\r/g, '\\r')
		   .replace(/\t/g, '\\t');
}

function validatePageData(pageData) {
	if (!pageData) return false;
	
	const requiredFields = ['url', 'title', 'pageContent', 'questions', 'interactiveElements'];
	return requiredFields.every(field => pageData.hasOwnProperty(field));
}

function truncateContent(content, maxLength = 50000) {
	if (typeof content !== 'string') return content;
	return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'get_api_key') {
		chrome.storage.local.get(['copycat_api_key'], (result) => {
			const apiKey = getApiKey(result.copycat_api_key);
			sendResponse({ apiKey: apiKey });
		});
		return true;
	}
});

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		getApiKey,
		isValidApiKey,
		sanitizeForJson,
		validatePageData,
		truncateContent,
		extractJSONFromResponse,
		createPrompt
	};
}
