/**
 * Dados da pagina de status, buscados do proprio `/health`.
 *
 * Arquivo separado de proposito: o `helmet` aplica CSP com `script-src 'self'`,
 * que bloqueia script inline. Externo passa sem precisar afrouxar a politica
 * com `unsafe-inline`.
 */
const el = (id) => document.getElementById(id);

/** "há 3 horas", "há 2 dias" — sem biblioteca. */
function relativo(desde) {
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const escalas = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ];

  let valor = Math.round((Date.now() - desde.getTime()) / 1000);
  for (const [unidade, limite] of escalas) {
    if (Math.abs(valor) < limite) return rtf.format(-Math.round(valor), unidade);
    valor /= limite;
  }
  return '';
}

function duracao(segundos) {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${Math.round(segundos)}s`;
}

async function carregar() {
  try {
    const resposta = await fetch('/health', { cache: 'no-store' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();

    el('status').dataset.state = 'up';
    el('status-text').textContent = 'no ar';

    const inicio = new Date(dados.startedAt);
    el('deploy-date').textContent = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(inicio);
    el('deploy-rel').textContent = relativo(inicio);

    el('env').textContent = dados.environment ?? '—';
    el('uptime').textContent = duracao(dados.uptimeSeconds ?? 0);
    el('commit').textContent = dados.commitShort ?? 'não informado';
    el('branch').textContent = dados.branch ?? 'não informado';
    el('node').textContent = dados.nodeVersion ?? '—';
  } catch (erro) {
    el('status').dataset.state = 'down';
    el('status-text').textContent = 'indisponível';
    el('deploy-date').textContent = '—';
    el('deploy-rel').textContent = String(erro?.message ?? erro);
  }
}

carregar();
// O uptime avanca sozinho; recarrega de vez em quando para nao ficar velho.
setInterval(carregar, 60_000);
