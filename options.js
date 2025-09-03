// CopyCat Options JavaScript
const apiKey = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const status = document.getElementById('status');

// Load saved settings on page load
(async () => {
  try {
    const data = await chrome.storage.local.get(['copycat_api_key', 'copycat_model']);
    apiKey.value = data.copycat_api_key || '';
    
    if (data.copycat_api_key) {
      await loadModels();
      modelSelect.value = data.copycat_model || '';
    }
  } catch (error) {
    showStatus('🚫 ERROR LOADING SETTINGS', true);
  }
})();

// Fetch available models from Groq API
async function fetchGroqModels(key) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data.map(model => model.id).sort();
  } catch (error) {
    console.error('Failed to fetch models:', error);
    throw error;
  }
}

// Load models into select dropdown
async function loadModels() {
  const key = apiKey.value.trim();
  
  if (!key || !key.startsWith('gsk_')) {
    modelSelect.innerHTML = '<option value="">🔑 ENTER VALID API KEY FIRST</option>';
    modelSelect.disabled = true;
    return;
  }
  
  try {
    showStatus('🔄 FETCHING MODELS...');
    const models = await fetchGroqModels(key);
    
    modelSelect.innerHTML = '';
    modelSelect.disabled = false;
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
    
    showStatus('✅ MODELS LOADED');
    
    // Try to restore previously selected model
    const data = await chrome.storage.local.get(['copycat_model']);
    if (data.copycat_model && models.includes(data.copycat_model)) {
      modelSelect.value = data.copycat_model;
    } else if (models.length > 0) {
      // Set default to llama-3.1-70b-versatile if available, otherwise first model
      const defaultModel = models.find(m => m === 'llama-3.1-70b-versatile') || models[0];
      modelSelect.value = defaultModel;
    }
    
  } catch (error) {
    modelSelect.innerHTML = '<option value="">🚫 FAILED TO LOAD MODELS</option>';
    modelSelect.disabled = true;
    showStatus('🚫 INVALID API KEY OR NETWORK ERROR', true);
  }
}

// Show status message with fade effect
function showStatus(message, isError = false) {
  status.textContent = message;
  status.className = `status show ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    status.classList.remove('show');
  }, 3000);
}

// Debounce function for API key input
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// API key change handler with debounce
apiKey.addEventListener('input', debounce(async () => {
  if (apiKey.value.trim().startsWith('gsk_')) {
    await loadModels();
  } else {
    modelSelect.innerHTML = '<option value="">🔑 ENTER VALID API KEY FIRST</option>';
    modelSelect.disabled = true;
  }
}, 500));

// Refresh models button handler
refreshModelsBtn.addEventListener('click', async () => {
  await loadModels();
});

// Save settings handler
saveBtn.addEventListener('click', async () => {
  const keyValue = apiKey.value.trim();
  const modelValue = modelSelect.value;
  
  // Validation
  if (!keyValue) {
    showStatus('🚫 API KEY REQUIRED', true);
    return;
  }
  
  if (!keyValue.startsWith('gsk_')) {
    showStatus('🚫 INVALID GROQ API KEY FORMAT', true);
    return;
  }
  
  if (!modelValue) {
    showStatus('🚫 MODEL SELECTION REQUIRED', true);
    return;
  }
  
  try {
    // Save to Chrome storage
    await chrome.storage.local.set({
      copycat_api_key: keyValue,
      copycat_model: modelValue
    });
    showStatus('💾 SETTINGS SAVED 🐱');
    
    // Optional: Test the API key by making a simple request
    await testApiKey(keyValue, modelValue);
    
  } catch (error) {
    showStatus('🚫 SAVE FAILED', true);
    console.error('Save error:', error);
  }
});

// Test API key functionality
async function testApiKey(key, model) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: 'Test message'
          }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });
    
    if (response.ok) {
      showStatus('✅ API KEY VERIFIED & WORKING');
    } else {
      showStatus('⚠️ SAVED BUT API KEY MAY BE INVALID', true);
    }
  } catch (error) {
    showStatus('⚠️ SAVED BUT COULDN\'T VERIFY API KEY', true);
  }
}

// Clear settings handler
clearBtn.addEventListener('click', async () => {
  if (!confirm('🗑️ Clear all settings?')) {
    return;
  }
  
  try {
    await chrome.storage.local.remove(['copycat_api_key', 'copycat_model']);
    apiKey.value = '';
    modelSelect.innerHTML = '<option value="">🔑 ENTER API KEY FIRST</option>';
    modelSelect.disabled = true;
    showStatus('🗑️ SETTINGS CLEARED');
  } catch (error) {
    showStatus('🚫 CLEAR FAILED', true);
    console.error('Clear error:', error);
  }
});

// Keyboard shortcuts for power users
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case 's':
        e.preventDefault();
        saveBtn.click();
        break;
      case 'r':
        e.preventDefault();
        refreshModelsBtn.click();
        break;
      case 'k':
        e.preventDefault();
        apiKey.focus();
        break;
      case 'm':
        e.preventDefault();
        modelSelect.focus();
        break;
    }
  }
  
  // ESC to clear focus
  if (e.key === 'Escape') {
    document.activeElement.blur();
  }
});

// Add visual feedback for keyboard shortcuts
document.addEventListener('DOMContentLoaded', () => {
  // Create keyboard shortcut hint
  const shortcutHint = document.createElement('div');
  shortcutHint.innerHTML = `
    <div style="position: fixed; bottom: 10px; right: 10px; font-size: 8px; color: #999; line-height: 1.2;">
      <div><span class="shortcut">CTRL+S</span> SAVE</div>
      <div><span class="shortcut">CTRL+R</span> REFRESH</div>
      <div><span class="shortcut">CTRL+K</span> FOCUS KEY</div>
      <div><span class="shortcut">CTRL+M</span> FOCUS MODEL</div>
    </div>
  `;
  document.body.appendChild(shortcutHint);
});

// Auto-focus API key field if empty
window.addEventListener('load', () => {
  if (!apiKey.value) {
    setTimeout(() => apiKey.focus(), 100);
  }
});

// Add paste handler for API key field
apiKey.addEventListener('paste', async (e) => {
  // Small delay to let paste complete, then validate
  setTimeout(async () => {
    if (apiKey.value.trim().startsWith('gsk_')) {
      await loadModels();
    }
  }, 100);
});