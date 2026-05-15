function ts() {
  return new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function log(msg, level='info') {
  const body = document.getElementById('log-body');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = '<span class="log-time">'+ts()+'</span><span class="log-'+level+'">'+level.toUpperCase().padEnd(7)+'</span><span class="log-msg">'+msg+'</span>';
  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
}

function clearLog() {
  document.getElementById('log-body').innerHTML = '';
}

function setStage(id, state) {
  const el = document.getElementById('stage-'+id);
  el.className = 'stage ' + state;
}

function setConnector(id, active) {
  document.getElementById('conn-'+id).className = 'connector' + (active ? ' active' : '');
}

function showLoading(bodyId, msg) {
  document.getElementById(bodyId).innerHTML =
    '<div class="loading"><div class="spinner"></div><div class="loading-text">'+msg+'</div></div>';
}

function scoreColor(v) {
  if (v >= 900) return '';
  if (v >= 700) return 'warn';
  return 'danger';
}

function savePrompt() {
  const textarea = document.getElementById('custom-prompt');
  localStorage.setItem('customPrompt', textarea.value);
}

window.onload = function() {
  const saved = localStorage.getItem('customPrompt');
  const wasOpen = localStorage.getItem('promptOpen') === 'true';
  if (saved) {
    const textarea = document.getElementById('custom-prompt');
    textarea.value = saved;
    if (wasOpen) {
      document.getElementById('customize-body').style.display = 'block';
      document.getElementById('toggle-arrow').textContent = '▾';
      document.getElementById('toggle-hint').textContent = 'click to collapse';
    }
  }
};

function trustColor(v) {
  if (v >= 900) return 'high';
  if (v >= 700) return '';
  return 'low';
}

function metricsHTML(m) {
  if (!m || Object.keys(m).length === 0) return '';
  const ts = m.trust_score || 0;
  const scores = [
    {label:'JAILBREAK', val: m.jailbreak_score},
    {label:'MOD INPUT', val: m.moderation_input},
    {label:'MOD OUTPUT', val: m.moderation_output},
    {label:'BIAS INPUT', val: m.bias_input},
    {label:'BIAS OUTPUT', val: m.bias_output},
  ];
  let gridHTML = scores.map(s => {
    const pct = Math.round((s.val/1000)*100);
    const cls = scoreColor(s.val);
    return '<div class="metric-item"><div class="metric-label">'+s.label+'</div><div class="metric-value">'+Math.round(s.val)+'</div><div class="metric-bar"><div class="metric-fill '+cls+'" style="width:'+pct+'%"></div></div></div>';
  }).join('');
  return '<div class="metrics-bar"><div class="metrics-title"><span>TUMERYK GUARD METRICS</span><span class="trust-score '+trustColor(ts)+'">'+ts+'</span></div><div class="metrics-grid">'+gridHTML+'</div></div>';
}

function parseTickers(text) {
  const formatted = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const matchTickerFirst = line.match(/\d*\.?\s*([A-Z]{1,5})\s*[,\s-–]\s*([A-Za-z][A-Za-z\s&.]+?)\s*[,]\s*([A-Za-z][A-Za-z\s&]+)/);
    const matchNameFirst = line.match(/([A-Za-z][A-Za-z\s&.,]+?)\s*[-–]\s*([A-Z]{1,5})\s*[-–]\s*([A-Za-z\s&]+)/);
    if (matchTickerFirst) {
    formatted.push({ sym: matchTickerFirst[1].trim(), name: matchTickerFirst[2].trim(), sector: matchTickerFirst[3].trim() });
    continue;
    } else if (matchNameFirst) {
    formatted.push({ name: matchNameFirst[1].trim(), sym: matchNameFirst[2].trim(), sector: matchNameFirst[3].trim() });
    continue;
    }
    const tickerOnly = line.replace(/[^A-Z,]/g, ' ').trim().split(/[\s,]+/).filter(t => t.length >= 1 && t.length <= 5);
    tickerOnly.forEach(sym => formatted.push({ sym, name: '', sector: '' }));
  }
  if (formatted.length === 0) {
    return text.split(',').map(t => ({ sym: t.trim().replace(/[^A-Z]/g,'').toUpperCase(), name: '', sector: '' })).filter(t => t.sym);
  }
  return formatted;
}

function parseAnalysis(text) {
  const items = [];
  let match;

  // Format 1: **TICKER (Company Name)**: content
  const boldTickerFirst = /\*\*([A-Z]{1,5})\s*\([^)]+\)\*\*[:\s]*([\s\S]*?)(?=\*\*[A-Z]{1,5}\s*\(|$)/g;
  while ((match = boldTickerFirst.exec(text)) !== null) {
    const sym = match[1].trim();
    const content = match[2].trim();
    if (sym && content) items.push({sym, text: content});
  }
  if (items.length) return items;

  // Format 2: **Company Name (TICKER)** - content
  const boldNameFirst = /\*\*[^*]+\(([A-Z]{1,5})\)\*\*[:\s-]*([\s\S]*?)(?=\d+\.\s*\*\*|\*\*[^*]+\([A-Z]{1,5}\)|$)/g;
  while ((match = boldNameFirst.exec(text)) !== null) {
    const sym = match[1].trim();
    const content = match[2].trim();
    if (sym && content) items.push({sym, text: content});
  }
  if (items.length) return items;

  // Format 3: ### Company Name (TICKER)
  const headingRegex = /#{1,3}\s*[^(#\n]+\(([A-Z]{1,5})\)[^\n]*([\s\S]*?)(?=#{1,3}|$)/g;
  while ((match = headingRegex.exec(text)) !== null) {
    const sym = match[1].trim();
    const content = match[2].trim();
    if (sym && content) items.push({sym, text: content});
  }
  if (items.length) return items;

  return [{sym: '', text: text}];
}

function parseRecs(text) {
  const items = [];
  const regex = /\*\*([A-Z]{1,5})[^*]*\*\*[\s\S]*?(?:- )?Recommendation[:\s]+([A-Z]+)[\s\S]*?(?:- )?Confidence[:\s]+(\w+)[\s\S]*?(?:- )?Reasoning[:\s]+([^\n*]+)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    items.push({
      sym: match[1].trim(),
      rec: match[2].toUpperCase(),
      conf: match[3].trim(),
      reason: match[4].trim()
    });
  }
  return items;
}

const agentCards = {};

function showAgentCard(role) {
  const card = agentCards[role];
  if (!card) return;

  document.getElementById('modal-agent-name').textContent = card.name || role;

  const fields = [
    {label: 'Description', value: card.description || '—'},
    {label: 'Version', value: card.version || '—'},
    {label: 'Protocol', value: card.protocolVersion || '—'},
    {label: 'Provider', value: card.provider || '—'},
    {label: 'URL', value: card.url || '—', mono: true},
    {label: 'Docs', value: card.documentationUrl || '—', mono: true},
    {label: 'Skills', value: card.skills && card.skills.length ? card.skills.join(', ') : '—'},
];

  document.getElementById('modal-fields').innerHTML = fields.map(f => `
    <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 0; border-bottom:1px solid var(--border);">
      <span style="font-family:'Space Mono',monospace; font-size:10px; color:var(--muted); width:100px; flex-shrink:0; padding-top:2px;">${f.label}</span>
      <span style="font-size:13px; color:var(--text); flex:1; line-height:1.5; ${f.mono ? "font-family:'Space Mono',monospace; font-size:11px; color:var(--muted); word-break:break-all;" : ''}">${f.value}</span>
    </div>
  `).join('');

  const modal = document.getElementById('agent-card-modal');
  modal.style.display = 'flex';
}

function closeAgentCard() {
  document.getElementById('agent-card-modal').style.display = 'none';
}

function renderCollector(tickers, parsedTickers) {
  console.log("DEBUG parsedTickers:", JSON.stringify(parsedTickers));
  let html = '<div class="ticker-list">';
  if (parsedTickers && parsedTickers.length > 0) {
    parsedTickers.forEach(item => {
      const label = item.name && item.sector
        ? item.sym + ' — ' + item.name + ' — ' + item.sector
        : item.name
          ? item.sym + ' — ' + item.name
          : item.sym;
      html += '<div class="ticker-item"><div><div class="ticker-sym">'+label+'</div><div class="ticker-label">Direct LLM call</div></div><div class="ticker-badge">NO GUARD</div></div>';
    });
  } else {
    tickers.split(',').map(t => t.trim()).filter(Boolean).forEach(sym => {
      html += '<div class="ticker-item"><div><div class="ticker-sym">'+sym+'</div><div class="ticker-label">Direct LLM call</div></div><div class="ticker-badge">NO GUARD</div></div>';
    });
  }
  html += '</div>';
  document.getElementById('body-collector').innerHTML = html;
}

function renderResearch(analysis, metrics) {
  const items = parseAnalysis(analysis);
  let html = (metrics && metrics.violation) ? '<div class="violation-banner"><div class="violation-icon">⚠</div><div class="violation-text">BLOCKED BY GUARD<br>Violation detected on input</div></div>' : '';
  html += '<div class="analysis-list">';
  items.forEach(item => {
    html += '<div class="analysis-item"><div class="analysis-sym">'+(item.sym||'')+'</div><div class="analysis-text">'+item.text+'</div></div>';
  });
  html += '</div>';
  html += metricsHTML(metrics);
  document.getElementById('body-research').innerHTML = html;
}

function renderDecision(recs, metrics) {
  const items = parseRecs(recs);
  let html = (metrics && metrics.violation) ? '<div class="violation-banner"><div class="violation-icon">⚠</div><div class="violation-text">BLOCKED BY GUARD<br>Violation detected on input</div></div>' : '';
  html += '<div class="rec-list">';
  items.forEach(item => {
    const cls = item.rec === 'BUY' ? 'badge-buy' : item.rec === 'SELL' ? 'badge-sell' : 'badge-hold';
    html += '<div class="rec-item"><div class="rec-sym">'+item.sym+'</div><div class="rec-badge '+cls+'">'+item.rec+'</div><div class="rec-reason">'+item.reason+'</div><div class="rec-conf">'+item.conf+'</div></div>';
  });
  html += '</div>';
  html += metricsHTML(metrics);
  document.getElementById('body-decision').innerHTML = html;
}

const DEFAULT_PROMPT = `You are a stock market researcher. Given a topic or sector, identify 3 relevant stock tickers to analyze. Return ONLY a comma separated list of tickers.\nExample: AAPL, TSLA, NVDA`;
let pendingAnalysis = null;

function togglePrompt() {
  const body = document.getElementById('customize-body');
  const arrow = document.getElementById('toggle-arrow');
  const hint = document.getElementById('toggle-hint');
  const textarea = document.getElementById('custom-prompt');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  arrow.textContent = isOpen ? '▸' : '▾';
  hint.textContent = isOpen ? 'click to expand' : 'click to collapse';
  localStorage.setItem('promptOpen', isOpen ? 'false' : 'true');  // add this line
  if (!isOpen) textarea.focus();
}

function resetPrompt() {
  document.getElementById('custom-prompt').value = DEFAULT_PROMPT;
  document.getElementById('prompt-score-pill').style.display = 'none';
}

function getCustomPrompt() {
  const body = document.getElementById('customize-body');
  const textarea = document.getElementById('custom-prompt');
  if (body.style.display === 'none') return null;
  const val = textarea.value.trim();
  return val === DEFAULT_PROMPT.trim() ? null : val || null;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showContinueButton() {
  const body = document.getElementById('body-decision');
  body.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; padding: 40px;">
      <button class="run-btn" onclick="continuePipeline()">CONTINUE →</button>
    </div>
  `;
}



async function runPipeline() {
  const promptArea = document.getElementById('custom-prompt');
  if (promptArea) promptArea.disabled = true;
  const topicInput = document.getElementById('topic-input');
  topicInput.disabled = true;
  const btn = document.getElementById('run-btn');
  btn.disabled = true;
  btn.textContent = 'RUNNING...';

  const topic = document.getElementById('topic-input').value.trim();
  if (!topic) {
    btn.disabled = false;
    btn.textContent = 'RUN →';
    topicInput.disabled = false;
    if (promptArea) promptArea.disabled = false;
    showToast('No topic entered — please enter a sector or stock to analyze.');
    return;
  }

  ['collector','research','decision'].forEach(id => setStage(id, ''));
  ['body-collector','body-research','body-decision'].forEach(id => {
    document.getElementById(id).innerHTML = '<div class="placeholder"><div class="placeholder-icon">◎</div><div class="placeholder-text">AWAITING</div></div>';
  });

  const pill = document.getElementById('prompt-score-pill');
  pill.style.display = 'none';
  const customPrompt = getCustomPrompt();

  if (customPrompt) {
    log('Scoring custom prompt through Guard...', 'info');
    try {
      const scoreRes = await fetch('/api/score-prompt', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({topic, custom_prompt: customPrompt})
      });
      const scoreData = await scoreRes.json();
      const pill = document.getElementById('prompt-score-pill');
      const ts = scoreData.trust_score || 0;
      pill.style.display = 'inline-block';
      if (scoreData.blocked) {
        pill.style.background = 'var(--red-dim)';
        pill.style.color = 'var(--red)';
        pill.style.borderColor = 'var(--red-border)';
        pill.textContent = 'BLOCKED · ' + ts;
        log('Custom prompt BLOCKED by Guard (trust score: ' + ts + ')', 'error');
        btn.disabled = false;
        btn.textContent = 'RUN →';
        topicInput.disabled = false;
        if (promptArea) promptArea.disabled = false;
        return;
      } else {
        pill.style.background = 'var(--green-dim)';
        pill.style.color = 'var(--green)';
        pill.style.borderColor = 'var(--green-border)';
        pill.textContent = 'SCORED · ' + ts;
        log('Custom prompt scored — trust score: ' + ts, 'success');
      }
    } catch(err) {
      log('Prompt scoring error: ' + err.message, 'warn');
    }
  }

  log('Pipeline started — topic: ' + topic);

  setStage('collector', 'active');
  showLoading('body-collector', 'Collecting tickers...');

  try {
    const res = await fetch('/api/run-research', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({topic, custom_prompt: customPrompt})
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({error:'HTTP '+res.status}));
      throw new Error(err.error || 'Server error');
    }

    const data = await res.json();
    console.log('recommendations:', data.recommendations);
    if (data.research_card) {
        agentCards['research'] = data.research_card;
        document.getElementById('btn-card-research').style.display = 'inline-block';
    }

    setStage('collector', 'complete');
    renderCollector(data.tickers, data.parsed_tickers);
    log('Stock Collector → tickers: '+data.tickers, 'success');

    setStage('research', 'active');
    showLoading('body-research', 'Guard → Research Analyst...');

    await new Promise(r => setTimeout(r, 400));

    const researchBlocked = data.research_metrics && data.research_metrics.violation;
    setStage('research', researchBlocked ? 'blocked' : 'complete');
    renderResearch(data.analysis, data.research_metrics);
    if (researchBlocked) {
      log('Research Analyst → BLOCKED by Guard (trust score: '+data.research_metrics.trust_score+')', 'warn');
    } else {
      log('Research Analyst → 200 OK (trust score: '+data.research_metrics.trust_score+')', 'success');
    }

    pendingAnalysis = data.analysis;
    showContinueButton();
    btn.disabled = false;
    btn.textContent = 'RUN →';
    topicInput.disabled = false;
    if (promptArea) promptArea.disabled = false;
    return;

    const decisionBlocked = data.decision_metrics && data.decision_metrics.violation;
    setStage('decision', decisionBlocked ? 'blocked' : 'complete');
    renderDecision(data.recommendations, data.decision_metrics);
    if (decisionBlocked) {
      log('Decision Maker → BLOCKED by Guard (trust score: '+data.decision_metrics.trust_score+')', 'warn');
    } else {
      log('Decision Maker → 200 OK (trust score: '+data.decision_metrics.trust_score+')', 'success');
    }

    log('Pipeline complete', 'success');

  } catch(err) {
    log('Pipeline error: '+err.message, 'error');
    ['collector','research','decision'].forEach(id => {
      const stage = document.getElementById('stage-'+id);
      if (!stage.classList.contains('complete')) setStage(id, 'blocked');
    });
  }

  btn.disabled = false;
  btn.textContent = 'RUN →';
  topicInput.disabled = false;
  if (promptArea) promptArea.disabled = false;
}

async function continuePipeline() {
  const btn = document.getElementById('run-btn');
  const promptArea = document.getElementById('custom-prompt');
  const topicInput = document.getElementById('topic-input');

  btn.disabled = true;
  topicInput.disabled = true;
  if (promptArea) promptArea.disabled = true;

  setStage('decision', 'active');
  showLoading('body-decision', 'Guard → Decision Maker...');

  try {
    const res = await fetch('/api/run-decision', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({analysis: pendingAnalysis})
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({error: 'HTTP ' + res.status}));
      throw new Error(err.error || 'Server error');
    }

    const data = await res.json();
    if (data.decision_card) {
        agentCards['decision'] = data.decision_card;
        document.getElementById('btn-card-decision').style.display = 'inline-block';
    }
    const decisionBlocked = data.decision_metrics && data.decision_metrics.violation;
    setStage('decision', decisionBlocked ? 'blocked' : 'complete');
    renderDecision(data.recommendations, data.decision_metrics);
    if (decisionBlocked) {
      log('Decision Maker → BLOCKED by Guard (trust score: ' + data.decision_metrics.trust_score + ')', 'warn');
    } else {
      log('Decision Maker → 200 OK (trust score: ' + data.decision_metrics.trust_score + ')', 'success');
    }

    log('Pipeline complete', 'success');
    pendingAnalysis = null;

  } catch(err) {
    log('Pipeline error: ' + err.message, 'error');
    setStage('decision', 'blocked');
  }

  btn.disabled = false;
  btn.textContent = 'RUN →';
  topicInput.disabled = false;
  if (promptArea) promptArea.disabled = false;
}

async function runAttack(attackName) {
  const btns = document.querySelectorAll('.attack-btn');
  btns.forEach(b => { b.disabled = true; b.classList.remove('active'); });
  const activeBtn = [...btns].find(b => b.textContent === attackName);
  if (activeBtn) activeBtn.classList.add('active');

  const resultEl = document.getElementById('attack-result');
  const promptBox = document.getElementById('attack-prompt-box');
  const metricsEl = document.getElementById('attack-metrics');

  resultEl.style.display = 'none';
  metricsEl.innerHTML = '<div class="loading"><div class="spinner"></div><div class="loading-text">Sending attack through Guard...</div></div>';
  resultEl.style.display = 'block';

  log('Red team attack started — type: ' + attackName, 'warn');

  try {
    const res = await fetch('/api/attack', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({attack_name: attackName})
    });

    const data = await res.json();

    promptBox.textContent = data.attack_prompt || '';

    const m = data.research_metrics || {};
    const blocked = m.violation;
    const ts = m.trust_score || 0;

    if (blocked) {
      log('Guard BLOCKED attack — trust score: ' + ts, 'error');
      metricsEl.innerHTML =
        '<div class="violation-banner"><div class="violation-icon">⚠</div><div class="violation-text">BLOCKED BY GUARD — Trust Score: ' + ts + '<br>Attack type: ' + attackName + '<br>Reason: ' + (m.block_reason || 'Policy violation') + '</div></div>'
        metricsHTML(m);
    } else {
      log('Attack passed Guard — trust score: ' + ts, 'warn');
      metricsEl.innerHTML =
        '<div style="color:var(--amber);font-family:Space Mono,monospace;font-size:11px;margin-bottom:8px;">⚠ NOT BLOCKED — trust score: ' + ts + '</div>' +
        metricsHTML(m);
    }

  } catch(err) {
    log('Attack request error: ' + err.message, 'error');
    metricsEl.innerHTML = '<div style="color:var(--red);font-family:Space Mono,monospace;font-size:11px;">Error: ' + err.message + '</div>';
  }

  btns.forEach(b => { b.disabled = false; b.classList.remove('active'); });
}

document.getElementById('topic-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') runPipeline();
});