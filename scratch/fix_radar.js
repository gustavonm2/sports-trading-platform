const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/pages/Radar.tsx');
let content = fs.readFileSync(targetFile, 'utf8');

// O bloco malformado que queremos substituir
const targetBlock = `                                         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                              {homeShotsBlocked} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsBlocked}
                                            </div>
                                          </div>
                                          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Dentro Área</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '4px', color: '#10b981' }}>
                                              {homeShotsInside} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsInside}
                                            </div>
                                          </div>
                                        </div>`;

const replacementBlock = `                                         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                           <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                             <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Finalizações</div>
                                             <div style={{ fontSize: '1.3rem', fontWeight: 900, marginTop: '6px', color: 'var(--text-primary)' }}>
                                               {homeTotalShots} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayTotalShots}
                                             </div>
                                           </div>
                                           <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                             <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Chutes ao Gol</div>
                                             <div style={{ fontSize: '1.3rem', fontWeight: 900, marginTop: '6px', color: 'var(--status-green)' }}>
                                               {homeShotsOn} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>vs</span> {awayShotsOn}
                                             </div>
                                           </div>
                                         </div>`;

// Normalizar quebras de linha para garantir a correspondência de strings no Mac/Unix
const normalizedContent = content.replace(/\r\n/g, '\n');
const normalizedTarget = targetBlock.replace(/\r\n/g, '\n');
const normalizedReplacement = replacementBlock.replace(/\r\n/g, '\n');

if (normalizedContent.includes(normalizedTarget)) {
  const updatedContent = normalizedContent.replace(normalizedTarget, normalizedReplacement);
  fs.writeFileSync(targetFile, updatedContent, 'utf8');
  console.log('✅ Radar.tsx corrigido e atualizado com sucesso!');
} else {
  console.error('❌ Não foi possível encontrar o bloco malformado em Radar.tsx.');
  // Vamos tentar uma correspondência mais flexível baseada em expressões regulares
  const regexPattern = /Raio-X de Finalizações\s*<\/h4>\s*<div style=\{\{\s*display:\s*['"]grid['"],\s*gridTemplateColumns:\s*['"]1fr\s*1fr['"],\s*gap:\s*['"]10px['"]\s*\}\}>\s*\{homeShotsBlocked\}[\s\S]*?Dentro Área[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/;
  const match = normalizedContent.match(regexPattern);
  if (match) {
    console.log('💡 Encontrado bloco malformado via RegExp, aplicando correção...');
    const updatedContent = normalizedContent.replace(regexPattern, `Raio-X de Finalizações</h4>\n${normalizedReplacement}`);
    fs.writeFileSync(targetFile, updatedContent, 'utf8');
    console.log('✅ Radar.tsx corrigido via RegExp com sucesso!');
  } else {
    console.error('❌ Falha na correspondência RegExp também.');
  }
}
