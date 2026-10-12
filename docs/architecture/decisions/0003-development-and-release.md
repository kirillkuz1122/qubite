# ADR-0003: архив, Git и выпуск

CONFIRMED прямым указанием пользователя: current main сохранён origin/tournaments и qubite-v1.0, commit 96f0457; архив не изменять. main для новой платформы; временные task branches допустимы после tested merge. Коммиты русский plain description, сразу push; существующая политика main сохранена.

RECOMMENDED для сложных migration tasks: task branch/PR даёт staged diff и тесты до merge, при этом canonical main остаётся мейнлайном. В этой baseline задаче docs/tests/harness commit в main. Нет самовольного force-push/reset/архив cleanup.

Push не deployment. CI содержит проверки без server credentials, но внешний autodeploy надо подтвердить OPS-001. Release включает verified backup/restore/staging/rollback и отдельное live approval. Тесты/документация не разрешают production migrations. При fail tests задача остаётся review/blocked с evidence, сломанный код не пушится.
