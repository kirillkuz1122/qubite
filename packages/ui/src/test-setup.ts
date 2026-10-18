import '@testing-library/jest-dom/vitest';

// В jsdom нет холста: компоненты с точками честно рисуют «ничего», а не шумят ошибками.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
