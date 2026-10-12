-- QUB-CORE-001: domain tables are introduced by later, separately tested tasks.
CREATE SCHEMA qubite_core;
COMMENT ON SCHEMA qubite_core IS 'Qubite 2.0 independent core; legacy SQLite is not accessed';
