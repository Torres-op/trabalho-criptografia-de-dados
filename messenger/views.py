from django.core.paginator import Paginator
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import render

from .models import Message

PAGE_SIZE = 20


def compose(request):
    return render(request, "messenger/compose.html")


def translator(request):
    return render(request, "messenger/translator.html")


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