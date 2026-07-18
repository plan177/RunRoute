import pytest
from unittest.mock import patch, MagicMock


FAKE_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyzSECRET_TOKEN_HERE"


def _make_builder_mock(mock_app):
    """Create a ApplicationBuilder mock that returns mock_app from .build().

    MagicMock() is callable and returns a NEW mock when called.
    We need builder() to return builder itself so the chain works.
    """
    builder = MagicMock()
    builder.return_value = builder
    builder.token.return_value = builder
    builder.post_init.return_value = builder
    builder.build.return_value = mock_app
    return builder


def test_invalid_token_exits_with_error():
    """InvalidToken is caught inside main(), sys.exit(1) is called."""
    from telegram.error import InvalidToken
    import bot as bot_mod

    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)), \
             patch("sys.exit") as mock_exit:
            bot_mod.main()
            mock_exit.assert_called_once_with(1)
    finally:
        bot_mod.BOT_TOKEN = orig_token


def test_invalid_token_log_does_not_contain_token(capsys):
    """Log output must not contain the actual BOT_TOKEN value."""
    from telegram.error import InvalidToken
    import bot as bot_mod

    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)), \
             patch("sys.exit"):
            bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token

    captured = capsys.readouterr()
    assert FAKE_TOKEN not in captured.out
    assert FAKE_TOKEN not in captured.err


def test_invalid_token_log_message_is_safe():
    """Only the safe redacted message is logged, not the exception."""
    from telegram.error import InvalidToken
    import bot as bot_mod

    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    mock_logger = MagicMock()
    orig_token = bot_mod.BOT_TOKEN
    orig_logger = bot_mod.logger
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        bot_mod.logger = mock_logger
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)), \
             patch("sys.exit"):
            bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token
        bot_mod.logger = orig_logger

    mock_logger.error.assert_called_once_with(
        "Telegram rejected BOT_TOKEN; rotate the token in deployment variables"
    )
    for arg in mock_logger.error.call_args[0]:
        assert FAKE_TOKEN not in str(arg)


def test_invalid_token_does_not_leak_exception_object():
    """The exception object itself is never passed to logger."""
    from telegram.error import InvalidToken
    import bot as bot_mod

    mock_app = MagicMock()
    exc = InvalidToken("Unauthorized: " + FAKE_TOKEN)
    mock_app.run_polling.side_effect = exc
    mock_logger = MagicMock()
    orig_token = bot_mod.BOT_TOKEN
    orig_logger = bot_mod.logger
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        bot_mod.logger = mock_logger
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)), \
             patch("sys.exit"):
            bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token
        bot_mod.logger = orig_logger

    mock_logger.error.assert_called_once()
    for arg in mock_logger.error.call_args[0]:
        assert not isinstance(arg, InvalidToken)
        assert FAKE_TOKEN not in str(arg)


def test_normal_startup_not_affected():
    """When run_polling succeeds, no exit or error occurs."""
    import bot as bot_mod

    mock_app = MagicMock()
    mock_app.run_polling.return_value = None
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)), \
             patch("sys.exit") as mock_exit:
            bot_mod.main()

            mock_exit.assert_not_called()
            mock_app.run_polling.assert_called_once()
    finally:
        bot_mod.BOT_TOKEN = orig_token


def test_missing_bot_token_returns_early():
    """When BOT_TOKEN is not set, main() returns without starting."""
    import bot as bot_mod

    mock_builder = MagicMock()
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = ""
        with patch.object(bot_mod, "ApplicationBuilder", mock_builder), \
             patch("sys.exit") as mock_exit:
            bot_mod.main()

            mock_builder.token.assert_not_called()
            mock_exit.assert_not_called()
    finally:
        bot_mod.BOT_TOKEN = orig_token
