from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Q
from django.http import HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.urls import reverse

from . import api
from .models import Message
from .participants import get_other_user

PAGE_SIZE = 20


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


def message_list(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Autenticação necessária."}, status=401)

    messages = (
        Message.objects.filter(
            Q(sender=request.user) | Q(recipient=request.user)
        )
        .select_related("sender", "recipient")
        .order_by("-received_at")
    )
    page = Paginator(messages, PAGE_SIZE).get_page(request.GET.get("page"))

    return JsonResponse(
        {
            "results": [
                {
                    "id": message.id,
                    "sender": message.sender.username,
                    "recipient": message.recipient.username,
                    "created_at": message.created_at.isoformat(),
                    "received_at": message.received_at.isoformat(),
                    "size": len(message.blob),
                }
                for message in page.object_list
            ],
            "page": page.number,
            "num_pages": page.paginator.num_pages,
            "count": page.paginator.count,
        }
    )


def messages_api(request):
    if request.method == "GET":
        return message_list(request)
    if request.method == "POST":
        return api.save_message(request)
    return HttpResponseNotAllowed(["GET", "POST"])