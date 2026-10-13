"""Explicit local operator CLI. Nothing executes when the API starts."""
import argparse
import getpass
import sys
import warnings

from ..config import ConfigurationError, Settings
from .accounts import IdentityError, bootstrap_owner
from .auth.store import AuthError, setup_owner_password


class OperatorParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default includes raw invalid/unknown values in diagnostics.
        self.exit(2, "Неверные аргументы identity CLI. Используйте --help; приватные значения через argv не принимаются.\n")


def main(argv=None) -> int:
    parser = OperatorParser(description="Локальное назначение owner и первоначального пароля; секреты не через argv")
    parser.add_argument("action", choices=["bootstrap-owner", "set-owner-password"])
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        settings.connection_options()  # Reject absent/unsafe config before prompting.
        if args.action == "set-owner-password":
            if not sys.stdin.isatty() or not sys.stderr.isatty():
                print("Для скрытого ввода пароля нужен интерактивный терминал")
                return 1
            with warnings.catch_warnings():
                # A TTY alone does not guarantee that echo can be disabled.
                # Reject getpass fallback before it reads an exposed password.
                warnings.simplefilter("error", getpass.GetPassWarning)
                password = getpass.getpass("Новый пароль owner: ")
                confirm = getpass.getpass("Повторите пароль: ")
            if password != confirm or input("Для первоначальной настройки введите SET OWNER PASSWORD: ") != "SET OWNER PASSWORD":
                print("Настройка пароля отменена")
                return 1
            owner = setup_owner_password(settings, password)
            print(f"Пароль owner настроен: {owner}")
            return 0
        email = input("Email нового owner (не передаётся через argv): ")
        if input("Для создания единственного owner введите CREATE OWNER: ") != "CREATE OWNER":
            print("Создание owner отменено; данные не изменены")
            return 1
        subject = bootstrap_owner(settings, email)
        print(f"Owner создан: {subject.id}")
        print("Почта ещё не подтверждена. Для пароля выполните set-owner-password в интерактивном терминале.")
        return 0
    except (EOFError, KeyboardInterrupt):
        print("Создание owner прервано")
        return 1
    except getpass.GetPassWarning:
        print("Скрытый ввод недоступен; пароль не запрашивался с включённым echo")
        return 1
    except (ConfigurationError, IdentityError, AuthError) as error:
        print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
