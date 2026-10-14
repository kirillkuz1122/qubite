-- Presentation metadata only. Preserve all grants, sessions and legacy module IDs.
INSERT INTO qubite_core.policy_modules(id) VALUES ('projects'),('atlas');
CREATE TABLE qubite_core.module_catalog (
    module text PRIMARY KEY REFERENCES qubite_core.policy_modules(id),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 400),
    label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
    tone text NOT NULL CHECK (tone IN ('orange','blue','yellow','green')),
    icon text NOT NULL CHECK (icon IN ('document','layers','calendar','search','pen','shield','lock','orbit')),
    position integer NOT NULL UNIQUE CHECK (position >= 0),
    visibility text NOT NULL DEFAULT 'locked' CHECK (visibility IN ('hidden','locked')),
    released boolean NOT NULL DEFAULT false
);
INSERT INTO qubite_core.module_catalog(module,name,summary,label,tone,icon,position) VALUES
('docs','Документы','Место для мыслей, заметок и знаний.','Qubite Docs','yellow','document',0),
('projects','Проекты','От первой идеи до последнего шага.','Qubite Projects','blue','layers',1),
('planner','Планировщик','Дела, которые обретают свой ритм.','Qubite Planner','green','calendar',2),
('search','Поиск','Найти ответ и вернуться к источнику.','Qubite Search','orange','search',3),
('writing','Редактор','Текст, в котором слышно тебя.','Qubite Writing','yellow','pen',4),
('vpn','Соединение','Твоё личное защищённое соединение.','Qubite VPN','blue','shield',5),
('vault','Хранилище','Отдельное место для секретов.','Qubite Vault','green','lock',6),
('atlas','Атлас','Увидеть связи между своими идеями.','Qubite Atlas','orange','orbit',7);
-- Neither presentation nor enabled=true proves an installed, runnable adapter.
