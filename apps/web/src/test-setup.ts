import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Без `globals` Testing Library сама не убирает отрисованное: провайдеры синхронизации
// жили бы дальше и дорисовывали экран после конца файла, когда jsdom уже снят
// («window is not defined» в CI).
afterEach(() => cleanup());
