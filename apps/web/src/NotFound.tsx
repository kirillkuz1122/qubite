import { useEffect } from 'react';

/**
 * «Такой страницы нет» — одна и та же на неизвестный адрес и на Owner Console для не-owner
 * (D-231): по странице и по названию вкладки их не отличить.
 */
export function NotFound() {
  useEffect(() => {
    document.title = 'Страницы нет · Qubite';
  }, []);
  return (
    <main className="shell">
      <h1>Такой страницы нет</h1>
      <a href="/">На главную</a>
    </main>
  );
}
