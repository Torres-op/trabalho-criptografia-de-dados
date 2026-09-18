from django.contrib.auth.decorators import login_required
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.urls import reverse

from .models import KeyBackup
from .participants import get_other_user


def session_context(request):
    peer = get_other_user(request.user)
    return {
        "username": request.user.get_username(),
        "peerUsername": peer.get_username(),
        "csrfToken": get_token(request),
        "endpoints": {
            "publishPublicKey": reverse("messenger:api-publish-public-key"),
            "peerPublicKey": reverse("messenger:api-public-key", args=[peer.get_username()]),
            "messages": reverse("messenger:api-messages"),
            "keyBackup": reverse("messenger:api-key-backup"),
            "fingerprint": reverse("messenger:api-fingerprint"),
        },
    }


def guarded_page(request, template):
    session = session_context(request)
    if not KeyBackup.objects.filter(user=request.user).exists():
        return redirect("messenger:identity")
    return render(request, template, {"session": session})


@login_required
def compose(request):
    return guarded_page(request, "messenger/compose.html")


@login_required
def translator(request):
    return guarded_page(request, "messenger/translator.html")


@login_required
def history(request):
    return render(request, "messenger/history.html", {"session": session_context(request)})


@login_required
def identity(request):
    return render(request, "messenger/identity.html", {"session": session_context(request)})
