import sys
import pytest
from unittest.mock import patch, MagicMock, AsyncMock


FAKE_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyzSECRET_TOKEN_HERE"
FAKE_CHAT_ID = 999999999


def _reload_bot():
    if 'bot' in sys.modules:
        del sys.modules['bot']
    import bot
    return bot


def _make_builder_mock(mock_app):
    builder = MagicMock()
    builder.return_value = builder
    builder.token.return_value = builder
    builder.post_init.return_value = builder
    builder.build.return_value = mock_app
    return builder


def _make_run():
    from datetime import datetime, timezone
    return {
        "id": 1,
        "telegram_user_id": FAKE_CHAT_ID,
        "title": "Test",
        "starts_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }


def test_invalid_token_exits_with_error():
    from telegram.error import InvalidToken
    bot_mod = _reload_bot()
    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)):
            with pytest.raises(SystemExit) as exc_info:
                bot_mod.main()
            assert exc_info.value.code == 1
    finally:
        bot_mod.BOT_TOKEN = orig_token


def test_invalid_token_log_does_not_contain_token(capsys):
    from telegram.error import InvalidToken
    bot_mod = _reload_bot()
    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)):
            with pytest.raises(SystemExit):
                bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token
    captured = capsys.readouterr()
    assert FAKE_TOKEN not in captured.out
    assert FAKE_TOKEN not in captured.err


def test_invalid_token_log_message_is_safe():
    from telegram.error import InvalidToken
    bot_mod = _reload_bot()
    mock_app = MagicMock()
    mock_app.run_polling.side_effect = InvalidToken("Unauthorized")
    mock_logger = MagicMock()
    orig_token = bot_mod.BOT_TOKEN
    orig_logger = bot_mod.logger
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        bot_mod.logger = mock_logger
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)):
            with pytest.raises(SystemExit):
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
    from telegram.error import InvalidToken
    bot_mod = _reload_bot()
    mock_app = MagicMock()
    exc = InvalidToken("Unauthorized: " + FAKE_TOKEN)
    mock_app.run_polling.side_effect = exc
    mock_logger = MagicMock()
    orig_token = bot_mod.BOT_TOKEN
    orig_logger = bot_mod.logger
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        bot_mod.logger = mock_logger
        with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)):
            with pytest.raises(SystemExit):
                bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token
        bot_mod.logger = orig_logger
    mock_logger.error.assert_called_once()
    for arg in mock_logger.error.call_args[0]:
        assert not isinstance(arg, InvalidToken)
        assert FAKE_TOKEN not in str(arg)


def test_invalid_token_with_fake_token_in_message(caplog):
    from telegram.error import InvalidToken
    import logging
    bot_mod = _reload_bot()
    mock_app = MagicMock()
    fake_msg = "Unauthorized: bot " + FAKE_TOKEN + " getMe"
    mock_app.run_polling.side_effect = InvalidToken(fake_msg)
    orig_token = bot_mod.BOT_TOKEN
    try:
        bot_mod.BOT_TOKEN = FAKE_TOKEN
        with caplog.at_level(logging.ERROR, logger="bot"):
            with patch.object(bot_mod, "ApplicationBuilder", _make_builder_mock(mock_app)):
                with pytest.raises(SystemExit):
                    bot_mod.main()
    finally:
        bot_mod.BOT_TOKEN = orig_token
    assert FAKE_TOKEN not in caplog.text


def test_normal_startup_not_affected():
    bot_mod = _reload_bot()
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
    bot_mod = _reload_bot()
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


def test_classify_forbidden():
    from telegram.error import Forbidden
    bot_mod = _reload_bot()
    assert bot_mod._classify_send_error(Forbidden("forbidden")) == "telegram_forbidden"


def test_classify_timed_out():
    from telegram.error import TimedOut
    bot_mod = _reload_bot()
    assert bot_mod._classify_send_error(TimedOut()) == "telegram_timeout"


def test_classify_network_error():
    from telegram.error import NetworkError
    bot_mod = _reload_bot()
    assert bot_mod._classify_send_error(NetworkError("fail")) == "telegram_network_error"


def test_classify_unexpected():
    bot_mod = _reload_bot()
    assert bot_mod._classify_send_error(RuntimeError("oops")) == "unexpected_error"


@pytest.mark.asyncio
async def test_send_message_error_uses_safe_code(caplog):
    import logging
    bot_mod = _reload_bot()
    mock_bot = MagicMock()
    mock_bot.send_message.side_effect = RuntimeError("password=secret123 host=db.internal")
    run = _make_run()

    with patch("backend.reminders.recover_stale_processing", new_callable=AsyncMock), \
         patch("backend.reminders.fetch_due_reminders", new_callable=AsyncMock, return_value=[run]), \
         patch("backend.reminders.verify_reminder_still_valid", new_callable=AsyncMock, return_value=True), \
         patch("backend.reminders.mark_sent", new_callable=AsyncMock), \
         patch("backend.reminders.mark_failed", new_callable=AsyncMock) as mock_fail:
        with caplog.at_level(logging.ERROR, logger="bot"):
            count = await bot_mod.process_due_reminders_once(mock_bot)

    assert count == 0
    mock_fail.assert_called_once_with(1, "unexpected_error")
    assert "secret123" not in caplog.text


@pytest.mark.asyncio
async def test_send_message_forbidden_uses_safe_code():
    from telegram.error import Forbidden
    bot_mod = _reload_bot()
    mock_bot = MagicMock()
    mock_bot.send_message.side_effect = Forbidden("forbidden")
    run = _make_run()
    run["id"] = 42

    with patch("backend.reminders.recover_stale_processing", new_callable=AsyncMock), \
         patch("backend.reminders.fetch_due_reminders", new_callable=AsyncMock, return_value=[run]), \
         patch("backend.reminders.verify_reminder_still_valid", new_callable=AsyncMock, return_value=True), \
         patch("backend.reminders.mark_sent", new_callable=AsyncMock), \
         patch("backend.reminders.mark_failed", new_callable=AsyncMock) as mock_fail:
        await bot_mod.process_due_reminders_once(mock_bot)

    mock_fail.assert_called_once_with(42, "telegram_forbidden")


@pytest.mark.asyncio
async def test_send_message_error_no_token_in_log(caplog):
    import logging
    bot_mod = _reload_bot()
    mock_bot = MagicMock()
    error_msg = "Unauthorized: bot " + FAKE_TOKEN + " getMe"
    mock_bot.send_message.side_effect = RuntimeError(error_msg)
    run = _make_run()

    with patch("backend.reminders.recover_stale_processing", new_callable=AsyncMock), \
         patch("backend.reminders.fetch_due_reminders", new_callable=AsyncMock, return_value=[run]), \
         patch("backend.reminders.verify_reminder_still_valid", new_callable=AsyncMock, return_value=True), \
         patch("backend.reminders.mark_sent", new_callable=AsyncMock), \
         patch("backend.reminders.mark_failed", new_callable=AsyncMock):
        with caplog.at_level(logging.ERROR, logger="bot"):
            await bot_mod.process_due_reminders_once(mock_bot)

    assert FAKE_TOKEN not in caplog.text
