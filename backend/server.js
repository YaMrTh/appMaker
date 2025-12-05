// backend/server.js

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

// --- DB setup ---------------------------------------------------------

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY,
      kanji TEXT,
      furigana TEXT,
      romaji TEXT,
      meaning TEXT,
      part_of_speech TEXT,
      topic TEXT,
      subtopic TEXT,
      politeness_level TEXT,
      jlpt_level TEXT,
      difficulty TEXT,
      notes TEXT,
      created_at DATETIME,
      updated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS sentence_templates (
      id INTEGER PRIMARY KEY,
      template_pattern TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME,
      updated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS template_slots (
      id INTEGER PRIMARY KEY,
      template_id INTEGER NOT NULL,
      slot_name TEXT NOT NULL,
      grammatical_role TEXT,
      part_of_speech TEXT,
      is_required INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY(template_id) REFERENCES sentence_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generated_sentences (
      id INTEGER PRIMARY KEY,
      template_id INTEGER,
      japanese_sentence TEXT NOT NULL,
      english_sentence TEXT,
      politeness_level TEXT,
      jlpt_level TEXT,
      difficulty TEXT,
      source_tag_id INTEGER,
      is_favorite INTEGER DEFAULT 0,
      created_at DATETIME,
      FOREIGN KEY(template_id) REFERENCES sentence_templates(id),
      FOREIGN KEY(source_tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS generated_sentence_vocabulary (
      id INTEGER PRIMARY KEY,
      generated_sentence_id INTEGER NOT NULL,
      vocabulary_id INTEGER NOT NULL,
      slot_name TEXT,
      created_at DATETIME,
      FOREIGN KEY(generated_sentence_id) REFERENCES generated_sentences(id) ON DELETE CASCADE,
      FOREIGN KEY(vocabulary_id) REFERENCES vocabulary(id)
    );

    CREATE TABLE IF NOT EXISTS practice_history (
      id INTEGER PRIMARY KEY,
      generated_sentence_id INTEGER NOT NULL,
      practiced_at DATETIME,
      result TEXT,
      notes TEXT,
      FOREIGN KEY(generated_sentence_id) REFERENCES generated_sentences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      parent_tag_id INTEGER,
      description TEXT,
      created_at DATETIME,
      updated_at DATETIME,
      FOREIGN KEY(parent_tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS taggings (
      id INTEGER PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      target_type TEXT NOT NULL, -- 'template', 'generated_sentence', etc.
      target_id INTEGER NOT NULL,
      created_at DATETIME,
      FOREIGN KEY(tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS tag_vocab_mapping (
      id INTEGER PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      vocab_topic TEXT NOT NULL,
      vocab_subtopic TEXT,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);
}

initSchema();

// --- Express setup ----------------------------------------------------

app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'web')));

// Helper to parse ints safely
function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

// --- TAGS -------------------------------------------------------------

// GET /api/tags  → used to populate tag & subtag selects
app.get('/api/tags', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, type, parent_tag_id, description FROM tags ORDER BY name')
    .all();
  res.json({ data: rows });
});

// GET /api/tag-mappings  → list for “Tags & Mapping” tile
app.get('/api/tag-mappings', (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        m.id AS mapping_id,
        t.name AS tag_name,
        p.name AS parent_tag_name,
        m.vocab_topic,
        m.vocab_subtopic,
        t.description
      FROM tag_vocab_mapping m
      JOIN tags t ON t.id = m.tag_id
      LEFT JOIN tags p ON p.id = t.parent_tag_id
      ORDER BY t.name
    `
    )
    .all();
  res.json({ data: rows });
});

// POST /api/tags-with-mapping  → “New” button in Tags tile
app.post('/api/tags-with-mapping', (req, res) => {
  const {
    name,
    type,
    parent_tag_id,
    description,
    vocab_topic,
    vocab_subtopic,
  } = req.body || {};

  if (!name || !vocab_topic) {
    return res.status(400).json({ error: 'name and vocab_topic are required' });
  }

  const now = new Date().toISOString();
  const insertTag = db.prepare(`
    INSERT INTO tags (name, type, parent_tag_id, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tagResult = insertTag.run(
    name,
    type || null,
    parent_tag_id ? Number(parent_tag_id) : null,
    description || null,
    now,
    now
  );

  const tagId = tagResult.lastInsertRowid;

  db.prepare(
    `INSERT INTO tag_vocab_mapping (tag_id, vocab_topic, vocab_subtopic)
     VALUES (?, ?, ?)`
  ).run(tagId, vocab_topic, vocab_subtopic || null);

  res.json({ tag_id: tagId });
});

// POST /api/tag-mappings/import  → Import CSV for Tags
app.post('/api/tag-mappings/import', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const now = new Date().toISOString();

  const tx = db.transaction((rowsToInsert) => {
    const getTagByName = db.prepare('SELECT * FROM tags WHERE name = ?');
    const insertTag = db.prepare(`
      INSERT INTO tags (name, type, parent_tag_id, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const getParent = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertMapping = db.prepare(`
      INSERT INTO tag_vocab_mapping (tag_id, vocab_topic, vocab_subtopic)
      VALUES (?, ?, ?)
    `);

    rowsToInsert.forEach((r) => {
      const tagName = r.tag_name || r.name;
      if (!tagName || !r.vocab_topic) return;

      let parentId = null;
      if (r.parent_tag_name) {
        const p = getParent.get(r.parent_tag_name);
        if (p) parentId = p.id;
      }

      let tag = getTagByName.get(tagName);
      if (!tag) {
        const resTag = insertTag.run(
          tagName,
          r.type || null,
          parentId,
          r.description || null,
          now,
          now
        );
        tag = { id: resTag.lastInsertRowid };
      }

      insertMapping.run(tag.id, r.vocab_topic, r.vocab_subtopic || null);
    });
  });

  tx(rows);

  res.json({ inserted: rows.length });
});

// POST /api/tag-mappings/delete-bulk
app.post('/api/tag-mappings/delete-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM tag_vocab_mapping WHERE id IN (${placeholders})`).run(
    ...ids
  );
  res.json({ deleted: ids.length });
});

// --- VOCABULARY -------------------------------------------------------

// GET /api/vocabulary?limit=&offset=&topic=&subtopic=&politeness=&jlpt=&difficulty=
app.get('/api/vocabulary', (req, res) => {
  const limit = toInt(req.query.limit, 20);
  const offset = toInt(req.query.offset, 0);

  const where = [];
  const params = [];

  if (req.query.topic) {
    where.push('topic = ?');
    params.push(req.query.topic);
  }
  if (req.query.subtopic) {
    where.push('subtopic = ?');
    params.push(req.query.subtopic);
  }
  if (req.query.politeness) {
    where.push('politeness_level = ?');
    params.push(req.query.politeness);
  }
  if (req.query.jlpt) {
    where.push('jlpt_level = ?');
    params.push(req.query.jlpt);
  }
  if (req.query.difficulty) {
    where.push('difficulty = ?');
    params.push(req.query.difficulty);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM vocabulary ${whereSql}`)
    .get(...params).c;

  const data = db
    .prepare(
      `SELECT * FROM vocabulary ${whereSql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ data, total });
});

// POST /api/vocabulary → “New” vocab entry
app.post('/api/vocabulary', (req, res) => {
  const body = req.body || {};
  if (!body.furigana && !body.kanji && !body.romaji && !body.meaning) {
    return res.status(400).json({ error: 'At least one of furigana/kanji/romaji/meaning required' });
  }
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO vocabulary (
      kanji, furigana, romaji, meaning,
      part_of_speech, topic, subtopic,
      politeness_level, jlpt_level, difficulty,
      notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    body.kanji || null,
    body.furigana || null,
    body.romaji || null,
    body.meaning || null,
    body.part_of_speech || null,
    body.topic || null,
    body.subtopic || null,
    body.politeness_level || null,
    body.jlpt_level || null,
    body.difficulty || null,
    body.notes || null,
    now,
    now
  );

  res.json({ id: result.lastInsertRowid });
});

// POST /api/vocabulary/import  → CSV import
app.post('/api/vocabulary/import', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO vocabulary (
      kanji, furigana, romaji, meaning,
      part_of_speech, topic, subtopic,
      politeness_level, jlpt_level, difficulty,
      notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rowsToInsert) => {
    rowsToInsert.forEach((r) => {
      stmt.run(
        r.kanji || null,
        r.furigana || null,
        r.romaji || null,
        r.meaning || null,
        r.part_of_speech || null,
        r.topic || null,
        r.subtopic || null,
        r.politeness_level || null,
        r.jlpt_level || null,
        r.difficulty || null,
        r.notes || null,
        now,
        now
      );
    });
  });

  tx(rows);
  res.json({ inserted: rows.length });
});

// POST /api/vocabulary/delete-bulk
app.post('/api/vocabulary/delete-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM vocabulary WHERE id IN (${placeholders})`).run(
    ...ids
  );
  res.json({ deleted: ids.length });
});

// --- SENTENCE TEMPLATES & SLOTS --------------------------------------

// GET /api/sentence-templates?limit=&offset=&tag_id=
app.get('/api/sentence-templates', (req, res) => {
  const limit = toInt(req.query.limit, 20);
  const offset = toInt(req.query.offset, 0);
  const tagId = req.query.tag_id ? Number(req.query.tag_id) : null;

  let whereSql = '';
  let joinSql = '';
  const params = [];

  if (tagId) {
    joinSql =
      'JOIN taggings tg ON tg.target_type = "template" AND tg.target_id = st.id';
    whereSql = 'WHERE tg.tag_id = ?';
    params.push(tagId);
  }

  const totalRow = db
    .prepare(
      `SELECT COUNT(DISTINCT st.id) AS c
       FROM sentence_templates st
       ${joinSql} ${whereSql}`
    )
    .get(...params);

  const data = db
    .prepare(
      `SELECT DISTINCT st.*
       FROM sentence_templates st
       ${joinSql} ${whereSql}
       ORDER BY st.updated_at DESC, st.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ data, total: totalRow.c });
});

// POST /api/sentence-templates
app.post('/api/sentence-templates', (req, res) => {
  const body = req.body || {};
  if (!body.template_pattern) {
    return res.status(400).json({ error: 'template_pattern is required' });
  }
  const now = new Date().toISOString();
  const isActive =
    body.is_active === true ||
    body.is_active === 'true' ||
    body.is_active === 'on' ||
    body.is_active === 1 ||
    body.is_active === '1'
      ? 1
      : 0;

  const stmt = db.prepare(`
    INSERT INTO sentence_templates (template_pattern, description, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    body.template_pattern,
    body.description || null,
    isActive,
    now,
    now
  );
  res.json({ id: result.lastInsertRowid });
});

// POST /api/sentence-templates/import
app.post('/api/sentence-templates/import', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sentence_templates (template_pattern, description, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rowsToInsert) => {
    rowsToInsert.forEach((r) => {
      if (!r.template_pattern) return;
      const isActive =
        r.is_active === true ||
        r.is_active === 'true' ||
        r.is_active === '1' ||
        r.is_active === 1
          ? 1
          : 0;
      stmt.run(
        r.template_pattern,
        r.description || null,
        isActive,
        now,
        now
      );
    });
  });

  tx(rows);
  res.json({ inserted: rows.length });
});

// POST /api/sentence-templates/delete-bulk
app.post('/api/sentence-templates/delete-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM sentence_templates WHERE id IN (${placeholders})`).run(
    ...ids
  );
  res.json({ deleted: ids.length });
});

// GET /api/template-slots?template_id=
app.get('/api/template-slots', (req, res) => {
  const templateId = Number(req.query.template_id);
  if (!templateId) {
    return res.status(400).json({ error: 'template_id required' });
  }
  const data = db
    .prepare(
      `SELECT * FROM template_slots
       WHERE template_id = ?
       ORDER BY order_index ASC, id ASC`
    )
    .all(templateId);
  res.json({ data });
});

// POST /api/template-slots
app.post('/api/template-slots', (req, res) => {
  const body = req.body || {};
  if (!body.template_id || !body.slot_name) {
    return res
      .status(400)
      .json({ error: 'template_id and slot_name are required' });
  }

  const isRequired =
    body.is_required === true ||
    body.is_required === 'true' ||
    body.is_required === 'on' ||
    body.is_required === 1 ||
    body.is_required === '1'
      ? 1
      : 0;

  const orderIndex = body.order_index ? Number(body.order_index) : 0;

  const stmt = db.prepare(`
    INSERT INTO template_slots (
      template_id, slot_name, grammatical_role, part_of_speech,
      is_required, order_index, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    Number(body.template_id),
    body.slot_name,
    body.grammatical_role || null,
    body.part_of_speech || null,
    isRequired,
    orderIndex,
    body.notes || null
  );

  res.json({ id: result.lastInsertRowid });
});

// POST /api/template-slots/import
app.post('/api/template-slots/import', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const stmt = db.prepare(`
    INSERT INTO template_slots (
      template_id, slot_name, grammatical_role, part_of_speech,
      is_required, order_index, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rowsToInsert) => {
    rowsToInsert.forEach((r) => {
      if (!r.template_id || !r.slot_name) return;
      const isRequired =
        r.is_required === true ||
        r.is_required === 'true' ||
        r.is_required === '1' ||
        r.is_required === 1
          ? 1
          : 0;
      const orderIndex = r.order_index ? Number(r.order_index) : 0;

      stmt.run(
        Number(r.template_id),
        r.slot_name,
        r.grammatical_role || null,
        r.part_of_speech || null,
        isRequired,
        orderIndex,
        r.notes || null
      );
    });
  });

  tx(rows);
  res.json({ inserted: rows.length });
});

// POST /api/template-slots/delete-bulk
app.post('/api/template-slots/delete-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM template_slots WHERE id IN (${placeholders})`).run(
    ...ids
  );
  res.json({ deleted: ids.length });
});

// --- SENTENCE LIBRARY (generated_sentences) ---------------------------

// GET /api/generated-sentences?limit=&offset=&tag_id=&politeness=&difficulty=
app.get('/api/generated-sentences', (req, res) => {
  const limit = toInt(req.query.limit, 20);
  const offset = toInt(req.query.offset, 0);

  const where = [];
  const params = [];

  if (req.query.tag_id) {
    where.push('gs.source_tag_id = ?');
    params.push(Number(req.query.tag_id));
  }
  if (req.query.politeness) {
    where.push('gs.politeness_level = ?');
    params.push(req.query.politeness);
  }
  if (req.query.difficulty) {
    where.push('gs.difficulty = ?');
    params.push(req.query.difficulty);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM generated_sentences gs
       ${whereSql}`
    )
    .get(...params).c;

  const data = db
    .prepare(
      `SELECT
         gs.*,
         t.name AS tag_name
       FROM generated_sentences gs
       LEFT JOIN tags t ON t.id = gs.source_tag_id
       ${whereSql}
       ORDER BY gs.created_at DESC, gs.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ data, total });
});

// POST /api/generated-sentences  → “New” in Sentence Library tile
app.post('/api/generated-sentences', (req, res) => {
  const body = req.body || {};
  if (!body.japanese_sentence) {
    return res.status(400).json({ error: 'japanese_sentence is required' });
  }
  const now = new Date().toISOString();
  const isFavorite =
    body.is_favorite === true ||
    body.is_favorite === 'true' ||
    body.is_favorite === 'on' ||
    body.is_favorite === 1 ||
    body.is_favorite === '1'
      ? 1
      : 0;

  const stmt = db.prepare(`
    INSERT INTO generated_sentences (
      template_id, japanese_sentence, english_sentence,
      politeness_level, jlpt_level, difficulty,
      source_tag_id, is_favorite, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    body.template_id ? Number(body.template_id) : null,
    body.japanese_sentence,
    body.english_sentence || null,
    body.politeness_level || null,
    body.jlpt_level || null,
    body.difficulty || null,
    body.source_tag_id ? Number(body.source_tag_id) : null,
    isFavorite,
    now
  );

  res.json({ id: result.lastInsertRowid });
});

// POST /api/generated-sentences/import
app.post('/api/generated-sentences/import', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const now = new Date().toISOString();

  const getTagByName = db.prepare('SELECT id FROM tags WHERE name = ?');

  const stmt = db.prepare(`
    INSERT INTO generated_sentences (
      template_id, japanese_sentence, english_sentence,
      politeness_level, jlpt_level, difficulty,
      source_tag_id, is_favorite, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rowsToInsert) => {
    rowsToInsert.forEach((r) => {
      if (!r.japanese_sentence) return;

      let tagId = null;
      if (r.source_tag_id) {
        tagId = Number(r.source_tag_id);
      } else if (r.tag_name) {
        const row = getTagByName.get(r.tag_name);
        if (row) tagId = row.id;
      }

      const isFavorite =
        r.is_favorite === true ||
        r.is_favorite === 'true' ||
        r.is_favorite === '1' ||
        r.is_favorite === 1
          ? 1
          : 0;

      stmt.run(
        r.template_id ? Number(r.template_id) : null,
        r.japanese_sentence,
        r.english_sentence || null,
        r.politeness_level || null,
        r.jlpt_level || null,
        r.difficulty || null,
        tagId,
        isFavorite,
        now
      );
    });
  });

  tx(rows);
  res.json({ inserted: rows.length });
});

// POST /api/generated-sentences/delete-bulk
app.post('/api/generated-sentences/delete-bulk', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM generated_sentences WHERE id IN (${placeholders})`).run(
    ...ids
  );
  res.json({ deleted: ids.length });
});

// POST /api/generated-sentences/:id/favorite
app.post('/api/generated-sentences/:id/favorite', (req, res) => {
  const id = Number(req.params.id);
  const { isFavorite } = req.body || {};
  const fav =
    isFavorite === true ||
    isFavorite === 'true' ||
    isFavorite === 1 ||
    isFavorite === '1'
      ? 1
      : 0;

  db.prepare(
    'UPDATE generated_sentences SET is_favorite = ? WHERE id = ?'
  ).run(fav, id);

  res.json({ id, is_favorite: fav });
});

// --- SENTENCE GENERATOR -----------------------------------------------

// POST /api/generate
// Body: { tagId, difficulty, jlptLevel, politenessLevel, displayField }
app.post('/api/generate', (req, res) => {
  const {
    tagId,
    difficulty,
    jlptLevel,
    politenessLevel,
    displayField = 'furigana',
  } = req.body || {};

  if (!tagId) {
    return res.status(400).json({ error: 'tagId is required' });
  }

  // 1) pick active templates for this tag
  const templates = db
    .prepare(
      `
      SELECT st.*
      FROM sentence_templates st
      JOIN taggings tg
        ON tg.target_type = 'template'
       AND tg.target_id = st.id
      WHERE tg.tag_id = ?
        AND st.is_active = 1
    `
    )
    .all(Number(tagId));

  if (!templates.length) {
    return res
      .status(400)
      .json({ error: 'No active templates mapped to this tag yet.' });
  }

  const template =
    templates[Math.floor(Math.random() * templates.length)];

  // 2) slots for the template
  const slots = db
    .prepare(
      `SELECT * FROM template_slots
       WHERE template_id = ?
       ORDER BY order_index ASC, id ASC`
    )
    .all(template.id);

  if (!slots.length) {
    return res
      .status(400)
      .json({ error: 'Selected template has no slots defined.' });
  }

  // 3) tag → vocab_topic/subtopic mappings
  const mappings = db
    .prepare(
      `SELECT vocab_topic, vocab_subtopic
       FROM tag_vocab_mapping
       WHERE tag_id = ?`
    )
    .all(Number(tagId));

  // helper to pick 1 vocab row for a slot
  function pickVocabForSlot(slot) {
    const where = ['part_of_speech = ?'];
    const params = [slot.part_of_speech || 'noun']; // default if missing

    if (difficulty) {
      where.push('(difficulty = ?)');
      params.push(difficulty);
    }
    if (jlptLevel) {
      where.push('(jlpt_level = ?)');
      params.push(jlptLevel);
    }
    if (politenessLevel) {
      where.push('(politeness_level = ?)');
      params.push(politenessLevel);
    }

    if (mappings.length) {
      const topicClauses = [];
      mappings.forEach((m) => {
        if (!m.vocab_topic) return;
        if (m.vocab_subtopic) {
          topicClauses.push('(topic = ? AND subtopic = ?)');
          params.push(m.vocab_topic, m.vocab_subtopic);
        } else {
          topicClauses.push('(topic = ?)');
          params.push(m.vocab_topic);
        }
      });
      if (topicClauses.length) {
        where.push('(' + topicClauses.join(' OR ') + ')');
      }
    }

    const sql =
      'SELECT * FROM vocabulary WHERE ' +
      where.join(' AND ') +
      ' ORDER BY RANDOM() LIMIT 1';

    const row = db.prepare(sql).get(...params);
    return row || null;
  }

  const chosen = {};
  const vocabRows = [];

  for (const slot of slots) {
    const v = pickVocabForSlot(slot);
    if (!v) {
      return res.status(400).json({
        error: `No vocabulary found for slot "${slot.slot_name}" (check topic/subtopic and filters).`,
      });
    }
    chosen[slot.slot_name] = v;
    vocabRows.push({ slot_name: slot.slot_name, row: v });
  }

  // 4) build final sentence string
  let sentence = template.template_pattern;
  Object.entries(chosen).forEach(([slotName, v]) => {
    const value =
      v[displayField] || v.kanji || v.romaji || v.furigana || v.meaning;
    const re = new RegExp(`{${slotName}}`, 'g');
    sentence = sentence.replace(re, value || '');
  });

  const tokens = sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ display: t }));

  // 5) compute overall difficulty / jlpt (very naive)
  const sentenceDifficulty =
    difficulty ||
    (vocabRows.some((x) => x.row.difficulty === 'Advanced')
      ? 'Advanced'
      : vocabRows.some((x) => x.row.difficulty === 'Intermediate')
      ? 'Intermediate'
      : vocabRows.some((x) => x.row.difficulty === 'Beginner')
      ? 'Beginner'
      : null);

  const sentenceJlpt =
    jlptLevel ||
    (vocabRows.reduce((acc, x) => acc || x.row.jlpt_level, null) || null);

  const sentencePoliteness =
    politenessLevel ||
    (vocabRows.reduce((acc, x) => acc || x.row.politeness_level, null) ||
      null);

  const now = new Date().toISOString();

  const insertSentence = db.prepare(`
    INSERT INTO generated_sentences (
      template_id, japanese_sentence, english_sentence,
      politeness_level, jlpt_level, difficulty,
      source_tag_id, is_favorite, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  const result = insertSentence.run(
    template.id,
    sentence,
    null,
    sentencePoliteness,
    sentenceJlpt,
    sentenceDifficulty,
    Number(tagId),
    now
  );

  const generatedId = result.lastInsertRowid;

  const insertGsv = db.prepare(`
    INSERT INTO generated_sentence_vocabulary (
      generated_sentence_id, vocabulary_id, slot_name, created_at
    )
    VALUES (?, ?, ?, ?)
  `);

  vocabRows.forEach((v) => {
    insertGsv.run(generatedId, v.row.id, v.slot_name, now);
  });

  res.json({
    id: generatedId,
    templateId: template.id,
    japaneseSentence: sentence,
    englishSentence: null,
    politeness_level: sentencePoliteness,
    jlpt_level: sentenceJlpt,
    difficulty: sentenceDifficulty,
    source_tag_id: Number(tagId),
    tokens,
  });
});

// --- Fallback: serve index.html for root ------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// --- Start server -----------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SentenceLab server listening on http://localhost:${PORT}`);
});
