"""Explicit local operator CLI. Nothing executes when the API starts."""
import argparse

from ..config import ConfigurationError, Settings
from .accounts import IdentityError, bootstrap_owner


class OperatorParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default includes raw invalid/unknown values in diagnostics.
        self.exit(2, "Неверные аргументы identity CLI. Используйте --help; приватные значения через argv не принимаются.\n")


def main(argv=None) -> int:
    parser = OperatorParser(description="Локальная настройка новых Qubite accounts; без password/login API")
    parser.add_argument("action", choices=["bootstrap-owner"])
    parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        settings.connection_options()  # Reject absent/unsafe config before prompting.
        email = input("Email нового owner (не передаётся через argv): ")
        if input("Для создания единственного owner введите CREATE OWNER: ") != "CREATE OWNER":
            print("Создание owner отменено; данные не изменены")
            return 1
        subject = bootstrap_owner(settings, email)
        print(f"Owner создан: {subject.id}")
        print("Почта ещё не подтверждена. Пароль и рабочий вход добавляются в AUTH-009.")
        return 0
    except (EOFError, KeyboardInterrupt):
        print("Создание owner прервано")
        return 1
    except (ConfigurationError, IdentityError) as error:
        print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
