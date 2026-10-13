"""Explicit local provider switches; credentials are environment references only."""
import argparse

from ...config import ConfigurationError, Settings
from ..auth.store import AuthError
from .store import set_enabled


class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, 'Неверные параметры настройки OAuth\n')


def main(argv=None):
    parser = Parser(description='Локальное включение/отключение OAuth; секреты не принимаются через argv')
    parser.add_argument('action', choices=['enable', 'disable'])
    parser.add_argument('provider', choices=['google', 'yandex', 'vk', 'telegram'])
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        if input('Подтвердите изменение: SET OAUTH PROVIDER: ') != 'SET OAUTH PROVIDER':
            print('Изменение OAuth отменено')
            return 1
        version = set_enabled(settings, args.provider, args.action == 'enable')
        print(f'OAuth {args.provider}: {args.action}, версия {version}')
        return 0
    except (ConfigurationError, AuthError):
        print('Настройка OAuth не подтверждена; проверьте локальную конфигурацию')
        return 1
    except (EOFError, KeyboardInterrupt):
        print('Изменение OAuth прервано')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
