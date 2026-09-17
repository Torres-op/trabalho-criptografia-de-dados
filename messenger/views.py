from django.contrib.auth.decorators import login_required
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.urls import reverse

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
        },
    }


@login_required
def compose(request):
    return render(request, "messenger/compose.html", {"session": session_context(request)})


@login_required
def translator(request):
    return render(request, "messenger/translator.html", {"session": session_context(request)})
