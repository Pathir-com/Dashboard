/**
 * Pathir Chat Widget v1.0
 *
 * Purpose:
 *   Self-contained embeddable chat widget that connects to ElevenLabs
 *   Conversational AI for text and voice conversations. Drop-in
 *   replacement for Chatbase — dental practices embed this on their
 *   website with a single <script> tag.
 *
 * Dependencies:
 *   - ElevenLabs Conversational AI WebSocket API (wss://api.elevenlabs.io)
 *   - Supabase Edge Function (chat-token) for signed URL generation
 *
 * Usage:
 *   <script
 *     src="https://amxcposgqlmgapzoopze.supabase.co/storage/v1/object/public/widget/pathir-chat.js"
 *     data-agent-id="agent_xxx"
 *     data-accent="#3072ff"
 *     data-title="Spark Dental"
 *     data-subtitle="Ask Poppy anything"
 *     data-token-url="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/chat-token"
 *   ></script>
 *
 * Changes:
 *   2026-03-11: Initial creation — text + voice modes, streaming responses.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // §1  Configuration — read data-* attributes from the <script> tag
  // ═══════════════════════════════════════════════════════════════════

  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var CFG = {
    agentId:  scriptEl.getAttribute('data-agent-id')  || '',
    accent:   scriptEl.getAttribute('data-accent')     || '#3072ff',
    title:    scriptEl.getAttribute('data-title')      || 'Chat with us',
    subtitle: scriptEl.getAttribute('data-subtitle')   || 'We typically reply instantly',
    tokenUrl: scriptEl.getAttribute('data-token-url')  || '',
    greeting: scriptEl.getAttribute('data-greeting')   || '',
    position: scriptEl.getAttribute('data-position')   || 'right', // 'left' | 'right'
  };

  if (!CFG.agentId) {
    console.warn('[Pathir Chat] data-agent-id is required.');
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §2  Colour utilities
  // ═══════════════════════════════════════════════════════════════════

  /** Convert hex (#rrggbb) to an rgba() string. */
  function rgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ═══════════════════════════════════════════════════════════════════
  // §3  Scoped CSS — injected once into <head>
  // ═══════════════════════════════════════════════════════════════════

  function injectStyles() {
    var accent = CFG.accent;
    var side = CFG.position === 'left' ? 'left' : 'right';
    var oppositeSide = side === 'left' ? 'right' : 'left';

    var css = [
      /* Reset within the widget */
      '.pathir-root, .pathir-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',

      /* ── Floating bubble ── */
      '.pathir-bubble {',
      '  position: fixed; bottom: 24px; ' + side + ': 24px; z-index: 2147483646;',
      '  width: 56px; height: 56px; border-radius: 50%;',
      '  background: ' + accent + '; color: #fff;',
      '  border: none; cursor: pointer;',
      '  box-shadow: 0 4px 16px ' + rgba(accent, 0.35) + ';',
      '  display: flex; align-items: center; justify-content: center;',
      '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
      '}',
      '.pathir-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 24px ' + rgba(accent, 0.45) + '; }',
      '.pathir-bubble svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',

      /* ── Chat window ── */
      '.pathir-window {',
      '  position: fixed; bottom: 92px; ' + side + ': 24px; z-index: 2147483647;',
      '  width: 380px; max-height: min(640px, calc(100vh - 120px));',
      '  border-radius: 24px; overflow: hidden;',
      '  background: #fff;',
      '  box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);',
      '  display: flex; flex-direction: column;',
      '  opacity: 0; transform: translateY(12px) scale(0.96);',
      '  pointer-events: none;',
      '  transition: opacity 0.25s ease, transform 0.25s ease;',
      '}',
      '.pathir-window.pathir-open {',
      '  opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;',
      '}',

      /* ── Header ── */
      '.pathir-header {',
      '  background: ' + accent + '; color: #fff;',
      '  padding: 20px 20px 16px; flex-shrink: 0;',
      '}',
      '.pathir-header-row { display: flex; align-items: center; justify-content: space-between; }',
      '.pathir-header-title { font-size: 16px; font-weight: 600; line-height: 1.3; }',
      '.pathir-header-subtitle { font-size: 12px; opacity: 0.8; margin-top: 2px; }',
      '.pathir-close-btn {',
      '  background: rgba(255,255,255,0.18); border: none; color: #fff;',
      '  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;',
      '  display: flex; align-items: center; justify-content: center;',
      '  transition: background 0.15s;',
      '}',
      '.pathir-close-btn:hover { background: rgba(255,255,255,0.3); }',
      '.pathir-close-btn svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2.5; }',

      /* ── Messages area ── */
      '.pathir-messages {',
      '  flex: 1; overflow-y: auto; padding: 16px 16px 8px;',
      '  display: flex; flex-direction: column; gap: 8px;',
      '  min-height: 200px;',
      '}',
      '.pathir-messages::-webkit-scrollbar { width: 4px; }',
      '.pathir-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }',

      /* ── Message bubbles ── */
      '.pathir-msg {',
      '  max-width: 82%; padding: 10px 14px; font-size: 14px; line-height: 1.5;',
      '  border-radius: 18px; word-wrap: break-word; white-space: pre-wrap;',
      '  animation: pathir-fade-in 0.2s ease;',
      '}',
      '.pathir-msg-agent {',
      '  align-self: flex-start; background: #f1f3f5; color: #1a1a1a;',
      '  border-bottom-left-radius: 6px;',
      '}',
      '.pathir-msg-user {',
      '  align-self: flex-end; background: ' + accent + '; color: #fff;',
      '  border-bottom-right-radius: 6px;',
      '}',

      /* ── Typing indicator ── */
      '.pathir-typing {',
      '  align-self: flex-start; padding: 10px 18px;',
      '  background: #f1f3f5; border-radius: 18px; border-bottom-left-radius: 6px;',
      '  display: flex; gap: 4px; align-items: center;',
      '}',
      '.pathir-typing-dot {',
      '  width: 6px; height: 6px; border-radius: 50%; background: #aaa;',
      '  animation: pathir-bounce 1.2s infinite;',
      '}',
      '.pathir-typing-dot:nth-child(2) { animation-delay: 0.15s; }',
      '.pathir-typing-dot:nth-child(3) { animation-delay: 0.3s; }',

      /* ── Input bar ── */
      '.pathir-input-bar {',
      '  display: flex; align-items: center; gap: 8px;',
      '  padding: 12px 12px 14px; border-top: 1px solid #f0f0f0;',
      '  flex-shrink: 0; background: #fff;',
      '}',
      '.pathir-text-input {',
      '  flex: 1; border: 1px solid #e5e7eb; border-radius: 24px;',
      '  padding: 10px 16px; font-size: 14px; outline: none;',
      '  transition: border-color 0.15s;',
      '  background: #fafafa;',
      '}',
      '.pathir-text-input:focus { border-color: ' + accent + '; background: #fff; }',
      '.pathir-text-input::placeholder { color: #aaa; }',

      /* Send button */
      '.pathir-send-btn {',
      '  width: 40px; height: 40px; border-radius: 50%;',
      '  background: ' + accent + '; color: #fff;',
      '  border: none; cursor: pointer; flex-shrink: 0;',
      '  display: flex; align-items: center; justify-content: center;',
      '  transition: opacity 0.15s, transform 0.15s;',
      '}',
      '.pathir-send-btn:disabled { opacity: 0.4; cursor: default; }',
      '.pathir-send-btn:not(:disabled):hover { transform: scale(1.06); }',
      '.pathir-send-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }',

      /* Voice toggle button */
      '.pathir-voice-btn {',
      '  width: 40px; height: 40px; border-radius: 50%;',
      '  background: #f1f3f5; color: #666;',
      '  border: none; cursor: pointer; flex-shrink: 0;',
      '  display: flex; align-items: center; justify-content: center;',
      '  transition: background 0.15s, color 0.15s;',
      '}',
      '.pathir-voice-btn:hover { background: #e5e7eb; color: #333; }',
      '.pathir-voice-btn.pathir-voice-active {',
      '  background: #fee2e2; color: #dc2626;',
      '  animation: pathir-pulse 1.5s infinite;',
      '}',
      '.pathir-voice-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',

      /* ── Status bar ── */
      '.pathir-status {',
      '  font-size: 11px; color: #999; text-align: center;',
      '  padding: 0 12px 6px; flex-shrink: 0;',
      '}',

      /* ── Powered-by footer ── */
      '.pathir-footer {',
      '  font-size: 10px; color: #bbb; text-align: center;',
      '  padding: 4px 12px 10px; flex-shrink: 0;',
      '}',
      '.pathir-footer a { color: #999; text-decoration: none; }',
      '.pathir-footer a:hover { text-decoration: underline; }',

      /* ── Animations ── */
      '@keyframes pathir-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }',
      '@keyframes pathir-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }',
      '@keyframes pathir-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.3); } 50% { box-shadow: 0 0 0 8px rgba(220,38,38,0); } }',

      /* ── Mobile responsive ── */
      '@media (max-width: 440px) {',
      '  .pathir-window { width: calc(100vw - 16px); ' + side + ': 8px; bottom: 82px; border-radius: 20px; }',
      '  .pathir-bubble { bottom: 16px; ' + side + ': 16px; }',
      '}',
    ].join('\n');

    var el = document.createElement('style');
    el.id = 'pathir-chat-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ═══════════════════════════════════════════════════════════════════
  // §4  SVG icon helpers — small inline icons used in the widget
  // ═══════════════════════════════════════════════════════════════════

  var ICONS = {
    /** Chat bubble icon for the floating button */
    chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',

    /** X icon for close button */
    close: '<svg viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

    /** Arrow-up icon for send button */
    send: '<svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',

    /** Microphone icon for voice toggle */
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="1" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',

    /** Stop icon shown when voice is active */
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
  };

  // ═══════════════════════════════════════════════════════════════════
  // §5  DOM Builder — creates the widget element tree
  // ═══════════════════════════════════════════════════════════════════

  /** Shorthand: create element, set className, optional innerHTML */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  /**
   * Build the full widget DOM and return references to interactive elements.
   * Nothing is appended to the document yet — the caller does that.
   */
  function buildDOM() {
    var root = el('div', 'pathir-root');

    /* ── Floating bubble ── */
    var bubble = el('button', 'pathir-bubble', ICONS.chat);
    bubble.setAttribute('aria-label', 'Open chat');
    root.appendChild(bubble);

    /* ── Chat window ── */
    var win = el('div', 'pathir-window');

    /* Header */
    var header = el('div', 'pathir-header');
    var headerRow = el('div', 'pathir-header-row');
    var titleWrap = el('div', '');
    titleWrap.appendChild(el('div', 'pathir-header-title', CFG.title));
    titleWrap.appendChild(el('div', 'pathir-header-subtitle', CFG.subtitle));
    headerRow.appendChild(titleWrap);
    var closeBtn = el('button', 'pathir-close-btn', ICONS.close);
    closeBtn.setAttribute('aria-label', 'Close chat');
    headerRow.appendChild(closeBtn);
    header.appendChild(headerRow);
    win.appendChild(header);

    /* Messages */
    var messages = el('div', 'pathir-messages');
    win.appendChild(messages);

    /* Status */
    var status = el('div', 'pathir-status');
    win.appendChild(status);

    /* Input bar */
    var inputBar = el('div', 'pathir-input-bar');
    var voiceBtn = el('button', 'pathir-voice-btn', ICONS.mic);
    voiceBtn.setAttribute('aria-label', 'Toggle voice');
    var textInput = document.createElement('input');
    textInput.className = 'pathir-text-input';
    textInput.type = 'text';
    textInput.placeholder = 'Type a message…';
    textInput.setAttribute('autocomplete', 'off');
    var sendBtn = el('button', 'pathir-send-btn', ICONS.send);
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.disabled = true;
    inputBar.appendChild(voiceBtn);
    inputBar.appendChild(textInput);
    inputBar.appendChild(sendBtn);
    win.appendChild(inputBar);

    /* Footer */
    var footer = el('div', 'pathir-footer');
    footer.innerHTML = 'Powered by <a href="https://pathir.com" target="_blank" rel="noopener">Pathir</a>';
    win.appendChild(footer);

    root.appendChild(win);

    return {
      root: root,
      bubble: bubble,
      win: win,
      closeBtn: closeBtn,
      messages: messages,
      status: status,
      textInput: textInput,
      sendBtn: sendBtn,
      voiceBtn: voiceBtn,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // §6  Audio Engine — microphone capture + agent audio playback
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Manages WebAudio for voice mode: captures microphone PCM and plays
   * back agent audio from base64-encoded chunks.
   */
  function AudioEngine() {
    var self = this;
    self.ctx = null;          // AudioContext
    self.stream = null;       // MediaStream from getUserMedia
    self.source = null;       // MediaStreamAudioSourceNode
    self.processor = null;    // ScriptProcessorNode (mic capture)
    self.active = false;
    self.onAudioChunk = null; // callback(base64Pcm) — set by caller
    self.nextPlayTime = 0;    // scheduled playback cursor (seconds)
    self.inputSampleRate = 0; // browser's native sample rate
    self.outputSampleRate = 16000; // ElevenLabs default; updated from server
    self.lastInterruptId = -1;
    self.gainNode = null;
  }

  /** Start capturing microphone audio. Returns a Promise. */
  AudioEngine.prototype.startCapture = function () {
    var self = this;
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(function (stream) {
      self.stream = stream;
      self.ctx = new (window.AudioContext || window.webkitAudioContext)();
      self.inputSampleRate = self.ctx.sampleRate;
      self.source = self.ctx.createMediaStreamSource(stream);

      /* Gain node for playback volume control */
      self.gainNode = self.ctx.createGain();
      self.gainNode.gain.value = 1.0;
      self.gainNode.connect(self.ctx.destination);

      /* Reset playback cursor */
      self.nextPlayTime = self.ctx.currentTime;

      /*
       * ScriptProcessorNode for capturing PCM — deprecated but universally
       * supported. BufferSize 4096 at 48 kHz ≈ 85 ms chunks.
       */
      self.processor = self.ctx.createScriptProcessor(4096, 1, 1);
      self.source.connect(self.processor);
      self.processor.connect(self.ctx.destination);

      self.processor.onaudioprocess = function (e) {
        if (!self.active) return;
        var float32 = e.inputBuffer.getChannelData(0);
        /* Resample from browser rate to the target rate (typically 16 kHz) */
        var resampled = resampleLinear(float32, self.inputSampleRate, self.outputSampleRate);
        var int16 = float32ToInt16(resampled);
        var b64 = uint8ToBase64(new Uint8Array(int16.buffer));
        if (self.onAudioChunk) self.onAudioChunk(b64);
      };

      self.active = true;
    });
  };

  /** Stop capturing and release microphone. */
  AudioEngine.prototype.stopCapture = function () {
    this.active = false;
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); this.stream = null; }
  };

  /**
   * Schedule a base64-encoded PCM chunk for playback.
   * Chunks are queued seamlessly so playback is gapless.
   */
  AudioEngine.prototype.playChunk = function (base64Pcm, eventId) {
    if (eventId <= this.lastInterruptId) return; // dropped — agent was interrupted
    if (!this.ctx) return;

    var bytes = base64ToUint8(base64Pcm);
    var int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    var float32 = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    var buffer = this.ctx.createBuffer(1, float32.length, this.outputSampleRate);
    buffer.getChannelData(0).set(float32);

    var src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gainNode);

    /* Schedule at the end of the current queue */
    var now = this.ctx.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now;
    src.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  };

  /** Interrupt agent playback — silence all queued audio. */
  AudioEngine.prototype.interrupt = function (eventId) {
    this.lastInterruptId = eventId;
    this.nextPlayTime = this.ctx ? this.ctx.currentTime : 0;
  };

  /** Tear down the AudioContext entirely. */
  AudioEngine.prototype.destroy = function () {
    this.stopCapture();
    if (this.ctx) { this.ctx.close().catch(function () {}); this.ctx = null; }
  };

  /* ── PCM conversion helpers ── */

  /** Linear interpolation resampler — good enough for real-time speech. */
  function resampleLinear(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    var ratio = fromRate / toRate;
    var len = Math.ceil(input.length / ratio);
    var output = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var srcIdx = i * ratio;
      var floor = Math.floor(srcIdx);
      var frac = srcIdx - floor;
      var a = input[floor] || 0;
      var b = input[Math.min(floor + 1, input.length - 1)] || 0;
      output[i] = a * (1 - frac) + b * frac;
    }
    return output;
  }

  /** Convert Float32 [-1, 1] to Int16 [-32768, 32767]. */
  function float32ToInt16(float32) {
    var int16 = new Int16Array(float32.length);
    for (var i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
    }
    return int16;
  }

  /* ── Base64 helpers (browser-safe, no atob for binary) ── */

  function uint8ToBase64(u8) {
    var str = '';
    for (var i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i]);
    return btoa(str);
  }

  function base64ToUint8(b64) {
    var raw = atob(b64);
    var u8 = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return u8;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §7  ConversationClient — manages the ElevenLabs WebSocket session
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Thin wrapper around the ElevenLabs Conversational AI WebSocket protocol.
   * Handles connection, text/voice messaging, ping/pong, and reconnection.
   *
   * Events (via callbacks):
   *   onAgentText(text, isFinal)  — agent response text (streaming or final)
   *   onUserTranscript(text)      — speech-to-text transcript of user speech
   *   onAudioChunk(b64, eventId)  — agent audio for playback
   *   onInterrupt(eventId)        — agent was interrupted; stop playback
   *   onConnect(conversationId)   — session is live
   *   onDisconnect(reason)        — session ended
   *   onError(msg)                — something went wrong
   *   onModeChange(mode)          — 'speaking' | 'listening'
   */
  function ConversationClient(cfg) {
    this.agentId = cfg.agentId;
    this.tokenUrl = cfg.tokenUrl;
    this.practiceId = null;       // set from chat-token response, passed as dynamic variable
    this.textOnly = true;         // start in text mode; toggled by voice
    this.ws = null;
    this.conversationId = null;
    this.connected = false;
    this._streamBuffer = '';      // accumulates streaming agent text
    this._streamActive = false;

    /*
     * Deduplication flags — ElevenLabs sends BOTH agent_response and
     * agent_chat_response_part for every utterance. We must only render
     * one of them. Whichever arrives first "claims" the turn; the other
     * is silently dropped.
     */
    this._responseDelivered = false; // agent_response already rendered this turn
    this._streamDelivered = false;   // streaming already rendered this turn

    /* Callbacks — set by the widget controller */
    this.onAgentText = null;
    this.onUserTranscript = null;
    this.onAudioChunk = null;
    this.onInterrupt = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.onModeChange = null;
  }

  /**
   * Open a WebSocket session. If a tokenUrl is configured, fetches a
   * signed URL first; otherwise connects directly with the agent ID.
   */
  ConversationClient.prototype.connect = function (textOnly) {
    var self = this;
    self.textOnly = textOnly !== false;

    /* Determine WebSocket URL */
    var urlPromise;
    if (self.tokenUrl) {
      urlPromise = fetch(self.tokenUrl + '?agent_id=' + encodeURIComponent(self.agentId))
        .then(function (r) {
          if (!r.ok) throw new Error('Token endpoint returned ' + r.status);
          return r.json();
        })
        .then(function (data) {
          /* Store practice_id from the token response for dynamic variables */
          if (data.practice_id) self.practiceId = data.practice_id;
          return data.signed_url;
        });
    } else {
      urlPromise = Promise.resolve(
        'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=' + encodeURIComponent(self.agentId)
      );
    }

    return urlPromise.then(function (wsUrl) {
      return new Promise(function (resolve, reject) {
        try {
          self.ws = new WebSocket(wsUrl, ['convai']);
        } catch (err) {
          reject(err);
          return;
        }

        self.ws.onopen = function () {
          /* Send client initialisation with mode overrides and practice context */
          var initMsg = {
            type: 'conversation_initiation_client_data',
            conversation_config_override: {
              conversation: { text_only: self.textOnly },
            },
            dynamic_variables: {
              channel: 'web_chat',
              practice_id: self.practiceId || '',
            },
          };
          self.ws.send(JSON.stringify(initMsg));
        };

        self.ws.onmessage = function (evt) {
          self._handleMessage(evt.data, resolve);
        };

        self.ws.onerror = function () {
          if (self.onError) self.onError('WebSocket connection failed');
          reject(new Error('WebSocket error'));
        };

        self.ws.onclose = function (evt) {
          self.connected = false;
          if (self.onDisconnect) self.onDisconnect(evt.reason || 'closed');
        };
      });
    });
  };

  /** Parse and dispatch a server message. */
  ConversationClient.prototype._handleMessage = function (raw, resolveConnect) {
    var msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    switch (msg.type) {

      /* ── Session established ── */
      case 'conversation_initiation_metadata': {
        var meta = msg.conversation_initiation_metadata_event || {};
        this.conversationId = meta.conversation_id || null;

        /* Store the server's preferred audio format for playback */
        if (meta.agent_output_audio_format) {
          var parts = meta.agent_output_audio_format.split('_');
          if (parts[1]) this._outputSampleRate = parseInt(parts[1], 10);
        }

        this.connected = true;
        if (this.onConnect) this.onConnect(this.conversationId);
        if (resolveConnect) resolveConnect();
        break;
      }

      /* ── Full agent response (non-streaming) ── */
      case 'agent_response': {
        var text = (msg.agent_response_event || {}).agent_response || '';
        if (!text || !this.onAgentText) break;

        /*
         * Skip if streaming already rendered this turn, OR if streaming
         * is currently in progress (it will handle display).
         */
        if (this._streamDelivered || this._streamActive) {
          this._streamDelivered = false; // reset for the next turn
          break;
        }

        /* Claim the turn — streaming will be suppressed if it arrives later */
        this._responseDelivered = true;
        this.onAgentText(text, true);
        break;
      }

      /* ── Streaming text chunks ── */
      case 'agent_chat_response_part': {
        var part = msg.text_response_part || {};

        if (part.type === 'start') {
          this._streamBuffer = '';
          this._streamActive = true;
          this._streamDelivered = false;
          /* Do NOT reset _responseDelivered — if agent_response already
             rendered this turn, streaming must be suppressed. */
        }

        if (part.type === 'delta' && part.text) {
          this._streamBuffer += part.text;
          /* Only emit if agent_response hasn't already claimed this turn */
          if (!this._responseDelivered && this.onAgentText) {
            this.onAgentText(this._streamBuffer, false);
          }
        }

        if (part.type === 'stop') {
          this._streamActive = false;
          this._streamDelivered = true;
          /* Only emit the final text if agent_response hasn't claimed it */
          if (!this._responseDelivered && this.onAgentText) {
            this.onAgentText(this._streamBuffer, true);
          }
          /* Reset responseDelivered for the next turn */
          this._responseDelivered = false;
        }
        break;
      }

      /* ── Agent response correction (rarer, but handle gracefully) ── */
      case 'agent_response_correction': {
        var correction = msg.agent_response_correction_event || {};
        if (correction.corrected_agent_response && this.onAgentText) {
          this.onAgentText(correction.corrected_agent_response, true);
        }
        break;
      }

      /* ── User speech transcript ── */
      case 'user_transcript': {
        var transcript = (msg.user_transcription_event || {}).user_transcript || '';
        if (transcript && this.onUserTranscript) this.onUserTranscript(transcript);
        break;
      }

      /* ── Agent audio (voice mode) ── */
      case 'audio': {
        var ae = msg.audio_event || {};
        if (ae.audio_base_64 && this.onAudioChunk) {
          this.onAudioChunk(ae.audio_base_64, ae.event_id || 0);
        }
        break;
      }

      /* ── Interruption — user spoke over the agent ── */
      case 'interruption': {
        var ie = msg.interruption_event || {};
        if (this.onInterrupt) this.onInterrupt(ie.event_id || 0);
        break;
      }

      /* ── Ping/pong keepalive ── */
      case 'ping': {
        var pe = msg.ping_event || {};
        this.ws.send(JSON.stringify({ type: 'pong', event_id: pe.event_id }));
        break;
      }

      /* ── Client tool calls (forward to webhook — not handled in widget) ── */
      case 'client_tool_call':
        break;

      default:
        break;
    }
  };

  /** Send a text message to the agent. */
  ConversationClient.prototype.sendText = function (text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    /* Reset dedup flags — new user turn means fresh agent response cycle */
    this._responseDelivered = false;
    this._streamDelivered = false;
    this._streamActive = false;
    this.ws.send(JSON.stringify({ type: 'user_message', text: text }));
  };

  /** Send a base64-encoded audio chunk (voice mode). */
  ConversationClient.prototype.sendAudio = function (base64Pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ user_audio_chunk: base64Pcm }));
  };

  /** Gracefully close the session. */
  ConversationClient.prototype.disconnect = function () {
    if (this.ws) {
      this.ws.close(1000, 'user');
      this.ws = null;
    }
    this.connected = false;
  };

  // ═══════════════════════════════════════════════════════════════════
  // §8  Widget Controller — wires UI ↔ ConversationClient ↔ Audio
  // ═══════════════════════════════════════════════════════════════════

  function PathirChatWidget() {
    this.dom = null;
    this.client = null;
    this.audio = null;
    this.isOpen = false;
    this.isConnecting = false;
    this.voiceActive = false;
    this._currentAgentEl = null; // reference to the streaming message bubble
    this._hasGreeted = false;
  }

  /** Initialise the widget — inject styles, build DOM, bind events. */
  PathirChatWidget.prototype.init = function () {
    injectStyles();
    this.dom = buildDOM();
    this.client = new ConversationClient({ agentId: CFG.agentId, tokenUrl: CFG.tokenUrl });
    this.audio = new AudioEngine();

    this._bindEvents();
    this._bindClient();

    document.body.appendChild(this.dom.root);
  };

  /** Bind UI event listeners. */
  PathirChatWidget.prototype._bindEvents = function () {
    var self = this;
    var dom = self.dom;

    /* Toggle open/close */
    dom.bubble.addEventListener('click', function () { self.toggle(); });
    dom.closeBtn.addEventListener('click', function () { self.toggle(); });

    /* Send on Enter or button click */
    dom.textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self._sendText(); }
    });
    dom.sendBtn.addEventListener('click', function () { self._sendText(); });

    /* Enable/disable send button based on input content */
    dom.textInput.addEventListener('input', function () {
      dom.sendBtn.disabled = !dom.textInput.value.trim();
    });

    /* Voice toggle */
    dom.voiceBtn.addEventListener('click', function () { self._toggleVoice(); });
  };

  /** Wire ConversationClient callbacks. */
  PathirChatWidget.prototype._bindClient = function () {
    var self = this;

    self.client.onConnect = function (convId) {
      self.isConnecting = false;
      self._setStatus('');
      self.dom.textInput.focus();
    };

    self.client.onDisconnect = function (reason) {
      self.isConnecting = false;
      if (self.voiceActive) self._stopVoice();
      self._setStatus('Disconnected');
    };

    self.client.onError = function (msg) {
      self.isConnecting = false;
      self._setStatus('Connection error — please try again');
    };

    self.client.onAgentText = function (text, isFinal) {
      self._removeTyping();
      if (isFinal) {
        /* Finalise the streaming bubble or create a new one */
        if (self._currentAgentEl) {
          self._currentAgentEl.textContent = text;
          self._currentAgentEl = null;
        } else {
          self._addMessage(text, 'agent');
        }
      } else {
        /* Streaming delta — update or create the bubble */
        if (!self._currentAgentEl) {
          self._currentAgentEl = self._addMessage(text, 'agent');
        } else {
          self._currentAgentEl.textContent = text;
        }
        self._scrollToBottom();
      }
    };

    self.client.onUserTranscript = function (text) {
      /* In voice mode, show what the user said */
      self._addMessage(text, 'user');
    };

    self.client.onAudioChunk = function (b64, eventId) {
      if (self.audio.ctx) {
        self.audio.playChunk(b64, eventId);
      }
    };

    self.client.onInterrupt = function (eventId) {
      self.audio.interrupt(eventId);
    };
  };

  /** Open or close the chat window. Connects on first open. */
  PathirChatWidget.prototype.toggle = function () {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.dom.win.classList.add('pathir-open');
      this.dom.bubble.setAttribute('aria-label', 'Close chat');
      /* Connect if not already connected */
      if (!this.client.connected && !this.isConnecting) {
        this._connect(true);
      } else {
        this.dom.textInput.focus();
      }
    } else {
      this.dom.win.classList.remove('pathir-open');
      this.dom.bubble.setAttribute('aria-label', 'Open chat');
    }
  };

  /** Establish the WebSocket session. */
  PathirChatWidget.prototype._connect = function (textOnly) {
    var self = this;
    self.isConnecting = true;
    self._setStatus('Connecting…');

    self.client.connect(textOnly).then(function () {
      self._setStatus('');
      /* Show a local greeting if the agent hasn't sent its first message yet */
      if (CFG.greeting && !self._hasGreeted) {
        self._hasGreeted = true;
        /* Wait briefly for the agent's first_message to arrive */
        setTimeout(function () {
          if (self.dom.messages.childElementCount === 0) {
            self._addMessage(CFG.greeting, 'agent');
          }
        }, 2000);
      }
    }).catch(function (err) {
      self.isConnecting = false;
      self._setStatus('Could not connect — please try again');
      console.error('[Pathir Chat]', err);
    });
  };

  /** Send the current text input value. */
  PathirChatWidget.prototype._sendText = function () {
    var text = this.dom.textInput.value.trim();
    if (!text) return;

    /* Ensure we're connected */
    if (!this.client.connected) {
      this._connect(true);
      /* Queue the message to send once connected */
      var self = this;
      var interval = setInterval(function () {
        if (self.client.connected) {
          clearInterval(interval);
          self.client.sendText(text);
        }
      }, 200);
    } else {
      this.client.sendText(text);
    }

    this._addMessage(text, 'user');
    this.dom.textInput.value = '';
    this.dom.sendBtn.disabled = true;
    this._showTyping();
  };

  /** Toggle voice mode on/off. */
  PathirChatWidget.prototype._toggleVoice = function () {
    if (this.voiceActive) {
      this._stopVoice();
    } else {
      this._startVoice();
    }
  };

  /** Activate voice mode — request mic, reconnect in voice mode if needed. */
  PathirChatWidget.prototype._startVoice = function () {
    var self = this;

    /* If currently in text-only mode, reconnect with audio */
    if (self.client.connected && self.client.textOnly) {
      self.client.disconnect();
    }

    self.audio.startCapture().then(function () {
      self.voiceActive = true;
      self.dom.voiceBtn.classList.add('pathir-voice-active');
      self.dom.voiceBtn.innerHTML = ICONS.stop;
      self._setStatus('Listening…');

      /* Wire audio capture to the WebSocket */
      self.audio.onAudioChunk = function (b64) {
        self.client.sendAudio(b64);
      };

      /* Connect in voice mode */
      if (!self.client.connected) {
        self._connect(false);
      }
    }).catch(function (err) {
      console.error('[Pathir Chat] Microphone access denied:', err);
      self._setStatus('Microphone access required for voice');
    });
  };

  /** Deactivate voice mode — stop mic, switch back to text. */
  PathirChatWidget.prototype._stopVoice = function () {
    this.voiceActive = false;
    this.audio.stopCapture();
    this.dom.voiceBtn.classList.remove('pathir-voice-active');
    this.dom.voiceBtn.innerHTML = ICONS.mic;
    this._setStatus('');
  };

  // ─── UI helpers ───

  /** Append a message bubble and return the element. */
  PathirChatWidget.prototype._addMessage = function (text, sender) {
    var bubble = el('div', 'pathir-msg pathir-msg-' + sender, '');
    bubble.textContent = text; // textContent prevents XSS
    this.dom.messages.appendChild(bubble);
    this._scrollToBottom();
    return bubble;
  };

  /** Show the three-dot typing indicator. */
  PathirChatWidget.prototype._showTyping = function () {
    if (this.dom.messages.querySelector('.pathir-typing')) return;
    var dots = el('div', 'pathir-typing');
    dots.innerHTML = '<span class="pathir-typing-dot"></span><span class="pathir-typing-dot"></span><span class="pathir-typing-dot"></span>';
    this.dom.messages.appendChild(dots);
    this._scrollToBottom();
  };

  /** Remove the typing indicator. */
  PathirChatWidget.prototype._removeTyping = function () {
    var t = this.dom.messages.querySelector('.pathir-typing');
    if (t) t.remove();
  };

  /** Update the small status text below messages. */
  PathirChatWidget.prototype._setStatus = function (text) {
    this.dom.status.textContent = text;
  };

  /** Scroll the messages container to the bottom. */
  PathirChatWidget.prototype._scrollToBottom = function () {
    var m = this.dom.messages;
    requestAnimationFrame(function () { m.scrollTop = m.scrollHeight; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // §9  Boot — auto-initialise when the DOM is ready
  // ═══════════════════════════════════════════════════════════════════

  function boot() {
    var widget = new PathirChatWidget();
    widget.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
