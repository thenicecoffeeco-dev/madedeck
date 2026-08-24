(function () {
  'use strict';

  const fontGroups = {
    'Clean & modern': ['Inter','Arial','Helvetica','Verdana','Trebuchet MS','Montserrat','Poppins','Josefin Sans','Fredoka'],
    'Bold & condensed': ['Arial Black','Impact','Anton','Bebas Neue','Oswald','Fjalla One','Staatliches','Russo One'],
    'Serif & formal': ['Georgia','Times New Roman','Garamond','Playfair Display','Cormorant Garamond','Cinzel','Roboto Slab','Graduate'],
    'Script & handwritten': ['Dancing Script','Great Vibes','Lobster','Pacifico','Permanent Marker','Special Elite','Comic Sans MS'],
    'Display & athletic': ['Bangers','Black Ops One','Bungee','Righteous','Copperplate','Rockwell'],
    Monospace: ['Courier New','Consolas','Lucida Console']
  };

  const textState = { font: 'Inter', shape: 'straight', curve: 45, letterSpacing: 0 };
  const $ = selector => document.querySelector(selector);

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
  }

  function loadFonts() {
    if ($('#mdEditorFonts')) return;
    const link = document.createElement('link');
    link.id = 'mdEditorFonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Bangers&family=Bebas+Neue&family=Black+Ops+One&family=Bungee&family=Cinzel:wght@400;700;900&family=Cormorant+Garamond:wght@400;700&family=Dancing+Script:wght@400;700&family=Fjalla+One&family=Fredoka:wght@400;700&family=Graduate&family=Great+Vibes&family=Josefin+Sans:wght@400;700&family=Lobster&family=Montserrat:wght@400;700;900&family=Oswald:wght@400;700&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:wght@400;700;900&family=Poppins:wght@400;700;900&family=Righteous&family=Roboto+Slab:wght@400;700;900&family=Russo+One&family=Special+Elite&family=Staatliches&display=swap';
    document.head.appendChild(link);
  }

  function fontOptions() {
    return Object.entries(fontGroups).map(([group, fonts]) =>
      `<optgroup label="${group}">${fonts.map(font => `<option value="${font}" style="font-family:${font}">${font}</option>`).join('')}</optgroup>`
    ).join('');
  }

  function pathGeometry() {
    const bend = Math.max(10, Math.min(90, Number(textState.curve) || 45));
    if (textState.shape === 'arch-up') return `M 15 ${75-bend*.45} Q 150 ${5-bend*.35} 285 ${75-bend*.45}`;
    if (textState.shape === 'arch-down') return `M 15 ${35+bend*.45} Q 150 ${105+bend*.35} 285 ${35+bend*.45}`;
    if (textState.shape === 'circle') return 'M 150 12 A 138 138 0 1 1 149.9 12';
    return 'M 10 80 L 290 80';
  }

  function renderPreview() {
    const preview = $('#designText');
    const input = $('#textInput');
    if (!preview || !input) return;
    const value = input.value.trim() || preview.dataset.text || '';
    preview.dataset.text = value;
    preview.style.fontFamily = textState.font;
    preview.style.letterSpacing = `${textState.letterSpacing}px`;
    preview.style.transform = 'none';
    if (!value || textState.shape === 'straight') {
      preview.textContent = value;
      return;
    }
    preview.innerHTML = `<svg viewBox="0 0 300 170" role="img" aria-label="${escapeXml(value)}" style="width:260px;overflow:visible"><defs><path id="mdTextCurve" d="${pathGeometry()}"/></defs><text fill="currentColor" text-anchor="middle" style="font-family:${escapeXml(textState.font)};letter-spacing:${textState.letterSpacing}px"><textPath href="#mdTextCurve" startOffset="50%">${escapeXml(value)}</textPath></text></svg>`;
  }

  function exposeProductionContract() {
    window.mdTextPathState = () => ({ ...textState, text: $('#textInput')?.value.trim() || '' });
    const original = window.mdBuildProductionPayload;
    if (typeof original !== 'function' || original.__textPathWrapped) return;
    const wrapped = function () {
      const payload = original();
      payload.editorTextPath = window.mdTextPathState();
      return payload;
    };
    wrapped.__textPathWrapped = true;
    window.mdBuildProductionPayload = wrapped;
  }

  function install() {
    const existing = $('#textToolsV4');
    if (!existing || $('#mdTextFormation')) return;
    loadFonts();
    existing.innerHTML = `<h4>Text styling</h4><label>Font<select id="mdFont">${fontOptions()}</select></label><label>Text formation<select id="mdTextFormation"><option value="straight">Straight</option><option value="arch-up">Arch upward</option><option value="arch-down">Arch downward</option><option value="circle">Full circle</option></select></label><label>Curve strength<input id="mdTextCurveStrength" type="range" min="10" max="90" value="45" disabled></label><label>Letter spacing<input id="mdTextLetterSpacing" type="range" min="-2" max="12" step="0.5" value="0"></label><div class="text-style-row"><button type="button" data-style="bold"><b>B</b></button><button type="button" data-style="italic"><i>I</i></button><button type="button" data-style="underline"><u>U</u></button></div><small style="display:block;margin-top:9px;color:#667085">Arch and circle text remain editable and are exported on a vector path.</small>`;
    $('#mdFont').addEventListener('change', event => { textState.font = event.target.value; renderPreview(); });
    $('#mdTextFormation').addEventListener('change', event => {
      textState.shape = event.target.value;
      $('#mdTextCurveStrength').disabled = textState.shape === 'straight';
      renderPreview();
    });
    $('#mdTextCurveStrength').addEventListener('input', event => { textState.curve = Number(event.target.value); renderPreview(); });
    $('#mdTextLetterSpacing').addEventListener('input', event => { textState.letterSpacing = Number(event.target.value); renderPreview(); });
    $('#textInput')?.addEventListener('input', renderPreview);
    $('#addTextBtn')?.addEventListener('click', () => setTimeout(renderPreview));
    exposeProductionContract();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}());

