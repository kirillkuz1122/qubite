import { EnglishModule } from '../EnglishLessons';

/**
 * «Английский» (ENG-001) — свой раздел-модуль, а не вкладка Агента (DS-013, находка 22, D-914).
 * Вкладки и урок по-прежнему в адресе: `/english?view=talk`, `/english?lesson=…`.
 */
export function EnglishScreen() {
  return (
    <>
      <p className="lead">
        Уроки с Нейтом по программе с нуля до A2: теория, задания, голос, огонёк. Нейт строгий:
        найдёт ошибку, объяснит и заставит повторить. Можно спросить по-русски.
      </p>
      <EnglishModule />
    </>
  );
}
