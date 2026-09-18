// ============================================================
// CEEA Feedback Widget v4 — naprawiony zrzut ekranu
// ============================================================

(function() {
    'use strict';
  
    const DEFAULT_CONFIG = {
      supabaseUrl: '',
      edgeFunctionUrl: '',
      anonKey: '',
      source: 'website',
      position: 'bottom-right',
      primaryColor: '#0ea5e9',
      lang: 'pl',
    };
  
    const config = Object.assign({}, DEFAULT_CONFIG, window.CEEA_FEEDBACK_CONFIG || {});
    if (!config.supabaseUrl || !config.edgeFunctionUrl) {
      console.warn('[CEEA Feedback] Brak konfiguracji!');
      return;
    }
  
    const I18N = {
      pl: {
        buttonLabel: 'Zgłoś błąd',
        buttonSub: 'lub pomysł',
        modalTitle: 'Zgłoś problem lub pomysł',
        typeLabel: 'Typ',
        typeBug: '🐛 Błąd techniczny',
        typeFeature: '💡 Propozycja zmiany',
        typeContent: '📝 Błąd w treści',
        typeOther: '📋 Inne',
        titleLabel: 'Tytuł',
        titlePlaceholder: 'np. Nie działa przycisk rejestracji',
        descLabel: 'Opis',
        descPlaceholder: 'Opisz szczegółowo co się stało...',
        emailLabel: 'Email (opcjonalnie)',
        emailPlaceholder: 'ktoś@example.com',
        screenshotBtn: '📸 Zrób zrzut ekranu',
        screenshotRetry: '🔄 Spróbuj ponownie',
        screenshotDone: '✅ Zrzut gotowy',
        screenshotError: '❌ Nie udało się zrobić zrzutu',
        consentLabel: 'Zgadzam się na przetwarzanie',
        submitBtn: 'Wyślij zgłoszenie',
        sending: 'Wysyłanie...',
        successTitle: 'Dziękujemy!',
        successText: 'Twoje zgłoszenie zostało wysłane. Rozpatrzymy je najszybciej jak to możliwe.',
        closeBtn: 'Zamknij',
        errorTitle: 'Ups, coś poszło nie tak',
        errorText: 'Nie udało się wysłać zgłoszenia. Spróbuj ponownie.',
        required: 'To pole jest wymagane',
        consentRequired: 'Wymagana zgoda',
      }
    };
  
    const t = I18N[config.lang] || I18N.pl;
    const primary = config.primaryColor;
  
    const styles = `
      :host {
        --fb-primary: ${primary};
        --fb-primary-light: color-mix(in srgb, ${primary}, white 85%);
        --fb-bg: #ffffff;
        --fb-surface: #f8fafc;
        --fb-text: #0f172a;
        --fb-text-secondary: #64748b;
        --fb-border: #e2e8f0;
        --fb-radius: 20px;
        --fb-shadow: 0 20px 60px -15px rgba(0,0,0,0.3);
        --fb-success: #10b981;
        --fb-error: #ef4444;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
  
      /* === TRIGGER === */
      .fb-trigger {
        position: fixed;
        ${config.position === 'bottom-left' ? 'left: 16px;' : 'right: 16px;'}
        bottom: 16px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: linear-gradient(135deg, var(--fb-primary) 0%, #0284c7 100%);
        color: white;
        border: none;
        border-radius: 50px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(14,165,233,0.35), 0 0 0 0 rgba(14,165,233,0.4);
        animation: fb-pulse 3s ease-in-out infinite;
        transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        letter-spacing: -0.01em;
        line-height: 1.2;
      }
      .fb-trigger:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 6px 24px rgba(14,165,233,0.5);
        animation: none;
      }
      .fb-trigger:active { transform: scale(0.96); }
      .fb-trigger-icon { font-size: 18px; display: flex; align-items: center; }
      .fb-trigger-sub { font-size: 10px; font-weight: 500; opacity: 0.8; display: block; }
  
      @keyframes fb-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(14,165,233,0.35), 0 0 0 0 rgba(14,165,233,0.4); }
        40% { box-shadow: 0 4px 16px rgba(14,165,233,0.35), 0 0 0 14px rgba(14,165,233,0); }
      }
  
      @media (min-width: 640px) {
        .fb-trigger { ${config.position === 'bottom-left' ? 'left: 24px;' : 'right: 24px;'} bottom: 24px; padding: 14px 22px; font-size: 15px; gap: 10px; }
        .fb-trigger-icon { font-size: 20px; }
        .fb-trigger-sub { font-size: 11px; }
      }
      @media (min-width: 1024px) {
        .fb-trigger { ${config.position === 'bottom-left' ? 'left: 32px;' : 'right: 32px;'} bottom: 32px; padding: 16px 26px; font-size: 16px; }
        .fb-trigger-icon { font-size: 22px; }
        .fb-trigger-sub { font-size: 12px; }
      }
      @media (max-width: 360px) {
        .fb-trigger { padding: 10px 14px; font-size: 12px; gap: 6px; }
        .fb-trigger-sub { display: none; }
        .fb-trigger-icon { font-size: 16px; }
      }
      @media (max-height: 500px) and (orientation: landscape) {
        .fb-trigger { padding: 8px 14px; font-size: 12px; ${config.position === 'bottom-left' ? 'left: 12px;' : 'right: 12px;'} bottom: 12px; }
        .fb-trigger-sub { display: none; }
      }
  
      /* === OVERLAY === */
      .fb-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(8px);
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
      }
      .fb-overlay.active { opacity: 1; visibility: visible; }
  
      /* === MODAL === */
      .fb-modal {
        background: var(--fb-bg);
        border-radius: var(--fb-radius);
        box-shadow: var(--fb-shadow);
        width: 100%;
        max-width: 440px;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: scale(0.9) translateY(40px);
        opacity: 0;
        transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .fb-overlay.active .fb-modal {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
  
      .fb-header {
        padding: 20px 24px 16px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        background: linear-gradient(135deg, var(--fb-primary-light) 0%, transparent 60%);
      }
      .fb-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
        color: var(--fb-text);
        letter-spacing: -0.02em;
      }
      .fb-header p {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--fb-text-secondary);
      }
      .fb-close {
        background: white;
        border: 1px solid var(--fb-border);
        width: 32px;
        height: 32px;
        border-radius: 10px;
        cursor: pointer;
        color: var(--fb-text-secondary);
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      .fb-close:hover { background: var(--fb-surface); color: var(--fb-text); }
  
      .fb-body {
        padding: 0 24px 24px;
        overflow-y: auto;
        flex: 1;
      }
  
      .fb-field {
        margin-bottom: 14px;
      }
      .fb-field label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: var(--fb-text-secondary);
        margin-bottom: 5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .fb-field input,
      .fb-field select,
      .fb-field textarea {
        width: 100%;
        padding: 10px 13px;
        border: 1.5px solid var(--fb-border);
        border-radius: 10px;
        font-size: 14px;
        font-family: inherit;
        color: var(--fb-text);
        background: white;
        box-sizing: border-box;
        transition: all 0.2s;
      }
      .fb-field input:focus,
      .fb-field select:focus,
      .fb-field textarea:focus {
        outline: none;
        border-color: var(--fb-primary);
        box-shadow: 0 0 0 3px var(--fb-primary-light);
      }
      .fb-field textarea {
        resize: vertical;
        min-height: 72px;
      }
      .fb-field .fb-error {
        color: var(--fb-error);
        font-size: 12px;
        margin-top: 4px;
        display: none;
        font-weight: 600;
      }
      .fb-field.invalid .fb-error { display: block; }
      .fb-field.invalid input,
      .fb-field.invalid select,
      .fb-field.invalid textarea { border-color: var(--fb-error); }
  
      .fb-checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 8px;
        transition: background 0.2s;
      }
      .fb-checkbox:hover { background: var(--fb-surface); }
      .fb-checkbox input {
        width: 18px;
        height: 18px;
        accent-color: var(--fb-primary);
        flex-shrink: 0;
        cursor: pointer;
      }
      .fb-checkbox span { font-size: 13px; color: var(--fb-text); }
  
      /* === SCREENSHOT SECTION === */
      .fb-screenshot-section {
        margin-bottom: 14px;
      }
      .fb-screenshot-btn {
        width: 100%;
        padding: 10px;
        background: var(--fb-surface);
        border: 1.5px dashed var(--fb-border);
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        color: var(--fb-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .fb-screenshot-btn:hover {
        border-color: var(--fb-primary);
        color: var(--fb-primary);
        background: var(--fb-primary-light);
      }
      .fb-screenshot-preview {
        margin-top: 10px;
        border-radius: 10px;
        overflow: hidden;
        border: 1.5px solid var(--fb-border);
        display: none;
      }
      .fb-screenshot-preview.active { display: block; }
      .fb-screenshot-preview img {
        width: 100%;
        display: block;
        max-height: 150px;
        object-fit: cover;
        object-position: top;
      }
      .fb-screenshot-status {
        font-size: 12px;
        font-weight: 600;
        margin-top: 6px;
        display: none;
      }
      .fb-screenshot-status.success { color: var(--fb-success); display: block; }
      .fb-screenshot-status.error { color: var(--fb-error); display: block; }
  
      .fb-submit {
        width: 100%;
        padding: 13px;
        background: linear-gradient(135deg, var(--fb-primary) 0%, #0284c7 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 4px 14px rgba(14,165,233,0.3);
        margin-top: 4px;
      }
      .fb-submit:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(14,165,233,0.4);
      }
      .fb-submit:disabled { opacity: 0.6; cursor: not-allowed; }
  
      .fb-loader {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: fb-spin 0.8s linear infinite;
      }
      @keyframes fb-spin { to { transform: rotate(360deg); } }
  
      .fb-result {
        text-align: center;
        padding: 40px 28px;
      }
      .fb-result-icon { font-size: 48px; margin-bottom: 12px; }
      .fb-result h3 { margin: 0 0 6px; font-size: 18px; font-weight: 800; }
      .fb-result p { margin: 0 0 20px; color: var(--fb-text-secondary); font-size: 14px; line-height: 1.5; }
      .fb-result button {
        padding: 11px 28px;
        background: var(--fb-primary);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }
  
      @media (max-width: 480px) {
        .fb-modal { max-height: 95vh; border-radius: 16px; }
        .fb-body { padding: 0 18px 18px; }
        .fb-header { padding: 16px 18px 12px; }
      }
    `;
  
    class CeeaFeedbackWidget extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.screenshotBase64 = null;
        this.consoleLogs = [];
        this.render();
        this.bindEvents();
      }
  
      render() {
        this.shadowRoot.innerHTML = `
          <style>${styles}</style>
  
          <button class="fb-trigger" title="${t.buttonLabel}" aria-label="${t.buttonLabel}">
            <span class="fb-trigger-icon">🐛</span>
            <span>
              ${t.buttonLabel}
              <span class="fb-trigger-sub">${t.buttonSub}</span>
            </span>
          </button>
  
          <div class="fb-overlay">
            <div class="fb-modal">
              <div class="fb-form-view">
                <div class="fb-header">
                  <div>
                    <h2>${t.modalTitle}</h2>
                    <p>Pomożemy Ci jak najszybciej</p>
                  </div>
                  <button class="fb-close">&times;</button>
                </div>
                <div class="fb-body">
                  <form class="fb-form">
                    <div class="fb-field">
                      <label for="fb-type">${t.typeLabel}</label>
                      <select id="fb-type" name="type" required>
                        <option value="bug">${t.typeBug}</option>
                        <option value="feature_request">${t.typeFeature}</option>
                        <option value="content_error">${t.typeContent}</option>
                        <option value="other">${t.typeOther}</option>
                      </select>
                      <div class="fb-error">${t.required}</div>
                    </div>
  
                    <div class="fb-field">
                      <label for="fb-title">${t.titleLabel}</label>
                      <input type="text" id="fb-title" name="title" placeholder="${t.titlePlaceholder}" required maxlength="200">
                      <div class="fb-error">${t.required}</div>
                    </div>
  
                    <div class="fb-field">
                      <label for="fb-desc">${t.descLabel}</label>
                      <textarea id="fb-desc" name="description" placeholder="${t.descPlaceholder}" maxlength="5000"></textarea>
                    </div>
  
                    <div class="fb-field">
                      <label for="fb-email">${t.emailLabel}</label>
                      <input type="email" id="fb-email" name="reporter_email" placeholder="${t.emailPlaceholder}">
                    </div>
  
                    <div class="fb-screenshot-section">
                      <button type="button" class="fb-screenshot-btn" id="fb-screenshot-btn">
                        ${t.screenshotBtn}
                      </button>
                      <div class="fb-screenshot-preview" id="fb-ss-preview">
                        <img id="fb-ss-img" src="" alt="Zrzut">
                      </div>
                      <div class="fb-screenshot-status" id="fb-ss-status"></div>
                    </div>
  
                    <label class="fb-checkbox">
                      <input type="checkbox" id="fb-consent" required>
                      <span>${t.consentLabel}</span>
                    </label>
  
                    <button type="submit" class="fb-submit">
                      <span>${t.submitBtn}</span>
                    </button>
                  </form>
                </div>
              </div>
  
              <div class="fb-result-view" style="display:none;">
                <div class="fb-result">
                  <div class="fb-result-icon"></div>
                  <h3></h3>
                  <p></p>
                  <button class="fb-close-result">${t.closeBtn}</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }
  
      bindEvents() {
        this.trigger = this.shadowRoot.querySelector('.fb-trigger');
        this.overlay = this.shadowRoot.querySelector('.fb-overlay');
        this.closeBtn = this.shadowRoot.querySelector('.fb-close');
        this.form = this.shadowRoot.querySelector('.fb-form');
        this.formView = this.shadowRoot.querySelector('.fb-form-view');
        this.resultView = this.shadowRoot.querySelector('.fb-result-view');
        this.closeResultBtn = this.shadowRoot.querySelector('.fb-close-result');
        this.ssBtn = this.shadowRoot.getElementById('fb-screenshot-btn');
        this.ssPreview = this.shadowRoot.getElementById('fb-ss-preview');
        this.ssImg = this.shadowRoot.getElementById('fb-ss-img');
        this.ssStatus = this.shadowRoot.getElementById('fb-ss-status');
  
        this.trigger.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());
        this.closeResultBtn.addEventListener('click', () => this.close());
        this.ssBtn.addEventListener('click', () => this.captureScreen());
        this.overlay.addEventListener('click', (e) => {
          if (e.target === this.overlay) this.close();
        });
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
  
        this._errorHandler = (msg, url, line, col, err) => {
          this.consoleLogs.push({ type: 'error', message: msg, url, line, col, time: new Date().toISOString() });
        };
        window.addEventListener('error', this._errorHandler);
      }
  
      open() {
        this.overlay.classList.add('active');
        this.formView.style.display = '';
        this.resultView.style.display = 'none';
        this.form.reset();
        this.shadowRoot.querySelectorAll('.fb-field').forEach(f => f.classList.remove('invalid'));
        this.screenshotBase64 = null;
        this.ssPreview.classList.remove('active');
        this.ssStatus.className = 'fb-screenshot-status';
        this.ssStatus.textContent = '';
        this.ssImg.src = '';
        this.ssBtn.innerHTML = t.screenshotBtn;
        document.body.style.overflow = 'hidden';
      }
  
      close() {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
  
      validate() {
        let valid = true;
        const title = this.shadowRoot.getElementById('fb-title');
        const consent = this.shadowRoot.getElementById('fb-consent');
        const type = this.shadowRoot.getElementById('fb-type');
  
        [title, type].forEach(el => {
          const field = el.closest('.fb-field');
          if (!el.value.trim()) {
            field.classList.add('invalid');
            valid = false;
          } else {
            field.classList.remove('invalid');
          }
        });
  
        const consentWrap = consent.closest('.fb-checkbox');
        if (!consent.checked) {
          consentWrap.style.color = 'var(--fb-error)';
          valid = false;
        } else {
          consentWrap.style.color = '';
        }
  
        return valid;
      }
  
      async captureScreen() {
        this.ssBtn.disabled = true;
        this.ssBtn.innerHTML = `<div class="fb-loader" style="width:14px;height:14px;border-width:2px;"></div> Robię zrzut...`;
      
        try {
          // Natywne API — idealna jakość
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' },
            preferCurrentTab: true,
            selfBrowserSurface: 'exclude',
          });
      
          const video = document.createElement('video');
          video.srcObject = stream;
          await video.play();
          await new Promise(r => setTimeout(r, 500)); // poczekaj na pierwszą klatkę
      
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0);
      
          stream.getTracks().forEach(track => track.stop());
          this.finishCapture(canvas);
        } catch (err) {
          // Użytkownik anulował lub API niedostępne → fallback html2canvas
          console.warn('[CEEA Feedback] getDisplayMedia failed, falling back:', err);
          await this.captureWithHtml2Canvas();
        } finally {
          this.ssBtn.disabled = false;
        }
      }
      
      finishCapture(canvas) {
        const maxWidth = 1200;
        let finalCanvas = canvas;
        if (canvas.width > maxWidth) {
          const ratio = maxWidth / canvas.width;
          finalCanvas = document.createElement('canvas');
          finalCanvas.width = maxWidth;
          finalCanvas.height = canvas.height * ratio;
          finalCanvas.getContext('2d').drawImage(canvas, 0, 0, maxWidth, finalCanvas.height);
        }
      
        const dataUrl = finalCanvas.toDataURL('image/png', 0.8);
        this.screenshotBase64 = dataUrl;
        this.ssImg.src = dataUrl;
        this.ssPreview.classList.add('active');
        this.ssStatus.className = 'fb-screenshot-status success';
        this.ssStatus.textContent = t.screenshotDone;
        this.ssBtn.innerHTML = t.screenshotRetry;
      }
  
      async handleSubmit(e) {
        e.preventDefault();
        if (!this.validate()) return;
  
        const submitBtn = this.shadowRoot.querySelector('.fb-submit');
        const originalText = submitBtn.innerHTML;
  
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="fb-loader"></div><span>${t.sending}</span>`;
  
        try {
          const browserInfo = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: `${screen.width}x${screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            devicePixelRatio: window.devicePixelRatio,
            url: window.location.href,
            title: document.title,
          };
  
          const payload = {
            type: this.shadowRoot.getElementById('fb-type').value,
            title: this.shadowRoot.getElementById('fb-title').value.trim(),
            description: this.shadowRoot.getElementById('fb-desc').value.trim(),
            page_url: window.location.href,
            source: config.source,
            screenshot_base64: this.screenshotBase64,
            browser_info: browserInfo,
            console_logs: this.consoleLogs.slice(-20),
            reporter_email: this.shadowRoot.getElementById('fb-email').value.trim() || null,
          };
  
          console.log('[CEEA Feedback] Submitting, screenshot:', !!this.screenshotBase64);
  
          const res = await fetch(config.edgeFunctionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.anonKey}`,
            },
            body: JSON.stringify(payload),
          });
  
          const data = await res.json();
  
          if (!res.ok) {
            throw new Error(data.error || 'HTTP ' + res.status);
          }
  
          this.showResult(true);
        } catch (err) {
          console.error('[CEEA Feedback] Submit error:', err);
          this.showResult(false);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
  
      loadScript(src) {
        return new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load ' + src));
          document.head.appendChild(script);
        });
      }
  
      showResult(success) {
        this.formView.style.display = 'none';
        this.resultView.style.display = '';
  
        const icon = this.resultView.querySelector('.fb-result-icon');
        const title = this.resultView.querySelector('h3');
        const text = this.resultView.querySelector('p');
  
        if (success) {
          icon.textContent = '✅';
          title.textContent = t.successTitle;
          text.textContent = t.successText;
          title.style.color = 'var(--fb-success)';
        } else {
          icon.textContent = '❌';
          title.textContent = t.errorTitle;
          text.textContent = t.errorText;
          title.style.color = 'var(--fb-error)';
        }
      }
  
      disconnectedCallback() {
        window.removeEventListener('error', this._errorHandler);
      }
    }
  
    if (!customElements.get('ceea-feedback-widget')) {
      customElements.define('ceea-feedback-widget', CeeaFeedbackWidget);
    }
  
    if (!document.querySelector('ceea-feedback-widget')) {
      const widget = document.createElement('ceea-feedback-widget');
      document.body.appendChild(widget);
    }
  })();