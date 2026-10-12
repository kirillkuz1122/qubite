const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qubite-tournaments-'));
Object.assign(process.env, {DATABASE_PATH:path.join(dir,'test.sqlite'),SEED_DEMO_DATA:'false',TELEGRAM_ENABLED:'false'});
const db = require('../src/db');
const runtime = require('../src/task-runtime');

test('catalog preserves ended tournaments and hides draft/archive/protected records', async () => {
  await db.initializeDatabase({seedDemoData:false});
  const make = (title,status,accessScope='open') => db.createTournament({title,description:'Test',status,accessScope,
    category:'other',startAt:'2026-01-01T00:00:00Z',endAt:'2026-01-02T00:00:00Z',ownerUserId:null,format:'individual'});
  const ended = await make('Ended','ended');
  await make('Draft','draft');await make('Archived','archived');await make('Hidden code','published','code');
  await make('Hidden closed','published','closed');
  const rows = await db.getTournaments(999999);
  assert.deepEqual(rows.map(r => r.id), [ended.id]);
});

test('multiple choice requires exact set; single-choice normalization keeps only the first selection', () => {
  const snapshot={taskType:'multiple_choice',answerConfig:{correctOptionIds:['A','C']}};
  assert.equal(runtime.judgeSubmission(snapshot,{selectedOptionIds:['C','A']}).verdict,'accepted');
  for(const selectedOptionIds of [['A'],['A','B','C']])
    assert.equal(runtime.judgeSubmission(snapshot,{selectedOptionIds}).verdict,'rejected');
  assert.deepEqual(runtime.normalizeSubmissionAnswer('single_choice',{selectedOptionIds:['B','A']}).selectedOptionIds,['B']);
});
test('numeric answers enforce tolerance and reject non-finite values', () => {
  const snapshot={taskType:'number',answerConfig:{acceptedNumber:10,tolerance:0.1}};
  assert.equal(runtime.judgeSubmission(snapshot,{numberAnswer:10.05}).verdict,'accepted');
  for(const numberAnswer of [11,Infinity,NaN])assert.equal(runtime.judgeSubmission(snapshot,{numberAnswer}).verdict,'rejected');
});
test('short text grading does not accept unrelated or empty answers', () => {
  const snapshot={taskType:'short_text',answerConfig:{acceptedAnswers:['граф']}};
  assert.equal(runtime.judgeSubmission(snapshot,{textAnswer:'граф'}).verdict,'accepted');
  for(const textAnswer of ['','дерево'])assert.equal(runtime.judgeSubmission(snapshot,{textAnswer}).verdict,'rejected');
});
