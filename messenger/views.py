from django.contrib.auth.decorators import login_required #Necessário ter Login
from django.core.paginator import Paginator # É o bgl de passar páginas sem mudar url so clicando em next
from django.db.models import Q #Faz o filtro aceitar condições de ou 
from django.http import JsonResponse #Json response
from django.shortcuts import render #Para renderizar

from .models import Mensagem

PAGE_SIZE = 20 #Da pra passar na env tbm


def compose(request):
    return render(request, "messenger/compose.html")


def translator(request):
    return render(request, "messenger/translator.html")


def message_list(request):
    if not request.user.is_authenticated: #Verifica se o usuário não está autenticado e emite um json se for True
        return JsonResponse({"detail": "Autenticação necessária."}, status=401)

    messages = (
        Mensagem.objects.filter(
            Q(remetente=request.user) | Q(destinatario=request.user)
        )
        .select_related("remetente", "destinatario")
        .order_by("-recebido_em")
    )#atribui uma lista de mensagens, só ira ver as mensagens quem estiver relacionado a mensagem, sendo remetente ou destinatario da mesma ordenando-os pelos mais recentes, e usando o select-related para obter o username em vez do id
    page = Paginator(messages, PAGE_SIZE).get_page(request.GET.get("page"))# Esse é o parametro lido em request.GET

    return JsonResponse(
        {
            "results": [
                {
                    "id": message.id,
                    "sender": message.remetente.username,
                    "recipient": message.destinatario.username,
                    "created_at": message.criado_em.isoformat(),
                    "received_at": message.recebido_em.isoformat(),
                    "size": len(message.blob),
                }
                for message in page.object_list
            ],
            "page": page.number,
            "num_pages": page.paginator.num_pages,
            "count": page.paginator.count,
        }
    )# A resposta que será retornada, contendo somente os metadados sem o blob, 