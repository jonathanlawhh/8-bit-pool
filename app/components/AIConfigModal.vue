<script setup>
import { PROVIDER_PRESETS } from '~/engine/ai.js';
import { clamp } from '~/engine/physics.js';

const { aiConfig, aiModalOpen, closeAIModal, saveAIModalConfig } = usePoolGame();

const form = reactive({
  provider: 'openai',
  endpoint: PROVIDER_PRESETS.openai.endpoint,
  model: PROVIDER_PRESETS.openai.model,
  apiKey: '',
  temperature: 0.2,
  systemPromptExtra: '',
});

const isLocalBot = computed(() => form.provider === 'local_bot');

watch(aiModalOpen, (open) => {
  if (!open) return;
  form.provider = aiConfig.value.provider || 'openai';
  form.endpoint = aiConfig.value.endpoint || PROVIDER_PRESETS.openai.endpoint;
  form.model = aiConfig.value.model || PROVIDER_PRESETS.openai.model;
  form.apiKey = aiConfig.value.apiKey || '';
  form.temperature = aiConfig.value.temperature ?? 0.2;
  form.systemPromptExtra = aiConfig.value.systemPromptExtra || '';
});

function handleProviderChange() {
  const preset = PROVIDER_PRESETS[form.provider];
  if (preset) {
    form.endpoint = preset.endpoint;
    form.model = preset.model;
  }
}

function handleSave() {
  saveAIModalConfig({
    provider: form.provider,
    endpoint: form.endpoint.trim(),
    model: form.model.trim(),
    apiKey: form.apiKey.trim(),
    temperature: clamp(Number(form.temperature) || 0.2, 0, 1.5),
    systemPromptExtra: form.systemPromptExtra.trim(),
  });
}
</script>

<template>
  <div
    id="aiConfigModal"
    class="modal-backdrop"
    :class="{ open: aiModalOpen }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="aiModalTitle"
    @click.self="closeAIModal()"
  >
    <div class="modal-card">
      <h2 id="aiModalTitle">AI Opponent Endpoint Config (LLM)</h2>

      <div class="field-group">
        <div class="field-label-row"><strong>Provider</strong></div>
        <select
          id="aiProviderSelect"
          v-model="form.provider"
          class="select-input"
          @change="handleProviderChange"
        >
          <option value="openai">OpenAI / OpenAI-Compatible Endpoint</option>
          <option value="gemini">Google Gemini REST Endpoint</option>
          <option value="local_bot">Offline Geometry Bot (No API Key)</option>
        </select>
      </div>

      <div class="field-group">
        <div class="field-label-row"><strong>API Endpoint URL</strong></div>
        <input
          id="aiEndpointInput"
          v-model="form.endpoint"
          class="text-input"
          type="url"
          placeholder="https://api.openai.com/v1/chat/completions"
          :disabled="isLocalBot"
        />
        <div class="helper-note">
          For Gemini, use <code>{model}</code> placeholder or full generateContent URL.
        </div>
      </div>

      <div class="field-group">
        <div class="field-label-row"><strong>Model Name</strong></div>
        <input
          id="aiModelInput"
          v-model="form.model"
          class="text-input"
          type="text"
          placeholder="gpt-4o-mini or gemini-2.5-flash"
          :disabled="isLocalBot"
        />
      </div>

      <div class="field-group">
        <div class="field-label-row">
          <strong>API Key (Stored locally in your browser)</strong>
        </div>
        <input
          id="aiApiKeyInput"
          v-model="form.apiKey"
          class="text-input"
          type="password"
          placeholder="sk-... or AIza..."
          autocomplete="off"
          :disabled="isLocalBot"
        />
      </div>

      <div class="field-group">
        <div class="field-label-row"><strong>Temperature (0.0 - 1.5)</strong></div>
        <input
          id="aiTempInput"
          v-model.number="form.temperature"
          class="num-input"
          style="width: 100px; text-align: left"
          type="number"
          min="0"
          max="1.5"
          step="0.05"
        />
      </div>

      <div class="field-group">
        <div class="field-label-row"><strong>Extra Strategy Prompt (Optional)</strong></div>
        <textarea
          id="aiExtraPromptInput"
          v-model="form.systemPromptExtra"
          class="json-textarea"
          style="min-height: 54px"
          placeholder="e.g. Prefer conservative safety shots if no direct pocket angle < 45 deg."
        />
      </div>

      <div class="modal-footer">
        <button id="btnCancelAIConfig" class="btn" type="button" @click="closeAIModal()">
          Cancel
        </button>
        <button
          id="btnSaveAIConfig"
          class="btn btn-primary"
          type="button"
          @click="handleSave()"
        >
          Save &amp; Use AI
        </button>
      </div>
    </div>
  </div>
</template>
