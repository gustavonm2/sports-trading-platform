const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/pages/Radar.tsx');
let content = fs.readFileSync(targetFile, 'utf8');

// Normalizar quebras de linha
let normalizedContent = content.replace(/\r\n/g, '\n');

// 1. Substituição RegExp para as declarações de variáveis
const varsRegex = /([ \t]*)const homeShotsOn = Number\(stats\.home\.shotsOnGoal\) \|\| 0;[\s\S]*?const awayCorners = Number\(stats\.away\.corners\) \|\| 0;/;
const varsMatch = normalizedContent.match(varsRegex);

let success = true;

if (varsMatch) {
  const indent = varsMatch[1];
  const replacementVars = `${indent}const homeShotsOn = Number(stats.home.shotsOnGoal) || 0;
${indent}const awayShotsOn = Number(stats.away.shotsOnGoal) || 0;
${indent}const homeTotalShots = Number(stats.home.totalShots) || 0;
${indent}const awayTotalShots = Number(stats.away.totalShots) || 0;
${indent}const homeCorners = Number(stats.home.corners) || 0;
${indent}const awayCorners = Number(stats.away.corners) || 0;`;

  normalizedContent = normalizedContent.replace(varsRegex, replacementVars);
  console.log('✅ Declarações de variáveis atualizadas com RegExp!');
} else {
  console.error('❌ Falha ao encontrar as declarações de variáveis via RegExp.');
  success = false;
}

// 2. Substituição RegExp para a UI do Raio-X de Finalizações
const uiRegex = /([ \t]*)<div style=\{\{\s*display:\s*['"]grid['"],\s*gridTemplateColumns:\s*['"]1fr\s*1fr['"],\s*gap:\s*['"]10px['"]\s*\}\}>[\s\S]*?No Alvo[\s\S]*?Dentro Área[\s\S]*?<\/div>\s*<\/div>(?=\s*\{\/\* Escanteios)/;
const uiMatch = normalizedContent.match(uiRegex);

if (uiMatch) {
  const indent = uiMatch[1];
  const replacementUI = `${indent}<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
${indent}  <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
${indent}    <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Finalizações</div>
${indent}    <div style={{ fontSize: '1.3rem', fontWeight: 900, marginTop: '6px', color: 'var(--text-primary)' }}>
${indent}      {homeTotalShots} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayTotalShots}
${indent}    </div>
${indent}  </div>
${indent}  <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
${indent}    <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Chutes ao Gol</div>
${indent}    <div style={{ fontSize: '1.3rem', fontWeight: 900, marginTop: '6px', color: 'var(--status-green)' }}>
${indent}      {homeShotsOn} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsOn}
${indent}    </div>
${indent}  </div>
${indent}</div>`;

  normalizedContent = normalizedContent.replace(uiRegex, replacementUI);
  console.log('✅ UI do Raio-X de Finalizações atualizada com RegExp!');
} else {
  console.error('❌ Falha ao encontrar o bloco visual de UI via RegExp.');
  success = false;
}

if (success) {
  fs.writeFileSync(targetFile, normalizedContent, 'utf8');
  console.log('🎉 Radar.tsx atualizado com sucesso e compilando 100%!');
} else {
  console.error('⚠️ Algumas substituições falharam. O arquivo não foi modificado.');
}
