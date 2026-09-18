from functools import wraps

from django.conf import settings
from django.contrib.auth.forms import AuthenticationForm
from django.core.cache import cache
from django.shortcuts import render

CACHE_PREFIX = "login-attempts"

BLOCKED_MESSAGE = (
    "Muitas tentativas de login deste endereço. Espere alguns minutos antes de tentar de novo."
)


def client_address(request):
    behind_proxy = getattr(settings, "SECURE_PROXY_SSL_HEADER", None) is not None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if behind_proxy and forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def attempts_key(request):
    return f"{CACHE_PREFIX}:{client_address(request)}"


def throttle_login(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.method != "POST":
            return view(request, *args, **kwargs)

        key = attempts_key(request)
        attempts = cache.get(key, 0)
        if attempts >= settings.LOGIN_MAX_ATTEMPTS:
            return render(
                request,
                "messenger/login.html",
                {"form": AuthenticationForm(), "blocked": BLOCKED_MESSAGE},
                status=429,
            )

        response = view(request, *args, **kwargs)
        if response.status_code == 302:
            cache.delete(key)
        else:
            cache.set(key, attempts + 1, settings.LOGIN_ATTEMPT_WINDOW)
        return response

    return wrapper
