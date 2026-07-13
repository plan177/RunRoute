import logging


def test_httpx_logger_level_in_bot():
    import importlib
    import bot as _bot
    importlib.reload(_bot)
    httpx_logger = logging.getLogger("httpx")
    assert httpx_logger.level >= logging.WARNING


def test_httpx_logger_level_in_backend():
    import importlib
    import backend.main as _main
    importlib.reload(_main)
    httpx_logger = logging.getLogger("httpx")
    assert httpx_logger.level >= logging.WARNING


def test_bot_token_not_in_logging_config():
    import os
    os.environ["BOT_TOKEN"] = "supersecret123token"
    import importlib
    import bot as _bot
    importlib.reload(_bot)
    httpx_logger = logging.getLogger("httpx")
    assert httpx_logger.level >= logging.WARNING
    assert "supersecret123token" not in str(httpx_logger.__dict__)
