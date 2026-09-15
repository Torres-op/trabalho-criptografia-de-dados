import base64
import binascii
import json
from functools import wraps

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .jwk import InvalidPublicKey, canonical_public_jwk, load_public_jwk
from .message_format import InvalidMessage, parse_header
from .models import Message, Profile
from .participants import NotAParticipant, get_other_user, participants, sender_id_for

KEY_CONFLICT_MESSAGE = (
    "Já existe outra chave pública registrada para você no servidor. Isso acontece "
    "quando os dados deste navegador são apagados ou quando você usa outro navegador. "
    "Restaure o backup da sua chave ou peça ao administrador para liberar um novo registro."
)


def error_response(status, code, message):
    return JsonResponse({"error": message, "code": code}, status=status)


def participant_api(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return error_response(401, "unauthenticated", "Faça login para continuar.")
        try:
            request.peer = get_other_user(request.user)
        except NotAParticipant as error:
            return error_response(403, "not_participant", str(error))
        return view(request, *args, **kwargs)

    return wrapper


def read_json_object(request):
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def key_payload(user, profile):
    return {
        "username": user.get_username(),
        "jwk": load_public_jwk(profile.ecdh_public_key),
        "registeredAt": profile.key_registered_at.isoformat()
        if profile.key_registered_at
        else None,
    }


def decode_blob(value):
    if not isinstance(value, str) or not value:
        raise InvalidMessage("O arquivo precisa ser enviado em base64.")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidMessage("O arquivo enviado não está em base64 válido.") from None


@require_http_methods(["POST"])
@participant_api
def publish_public_key(request):
    payload = read_json_object(request)
    if payload is None:
        return error_response(400, "invalid_json", "O corpo da requisição precisa ser um objeto JSON.")

    try:
        canonical = canonical_public_jwk(payload.get("jwk"))
    except InvalidPublicKey as error:
        return error_response(400, "invalid_jwk", str(error))

    with transaction.atomic():
        profile = Profile.objects.select_for_update().get(user=request.user)

        if profile.ecdh_public_key == canonical:
            return JsonResponse(key_payload(request.user, profile), status=200)
        if profile.ecdh_public_key:
            return error_response(409, "key_conflict", KEY_CONFLICT_MESSAGE)

        profile.ecdh_public_key = canonical
        profile.key_registered_at = timezone.now()
        profile.fingerprint_verified = False
        profile.save(update_fields=["ecdh_public_key", "key_registered_at", "fingerprint_verified"])

    return JsonResponse(key_payload(request.user, profile), status=201)


@require_http_methods(["GET"])
@participant_api
def fetch_public_key(request, username):
    target = participants().select_related("profile").filter(username=username).first()
    if target is None:
        return error_response(404, "user_not_found", "Usuário não encontrado.")
    if not target.profile.ecdh_public_key:
        return error_response(
            404,
            "key_not_published",
            f"{username} ainda não registrou uma chave pública. Ela é criada no primeiro "
            "acesso ao app.",
        )
    return JsonResponse(key_payload(target, target.profile))


@require_http_methods(["POST"])
@participant_api
def save_message(request):
    payload = read_json_object(request)
    if payload is None:
        return error_response(400, "invalid_json", "O corpo da requisição precisa ser um objeto JSON.")

    direction = payload.get("direction")
    if direction not in Message.Direction.values:
        return error_response(
            400, "invalid_direction", "Informe se a mensagem foi enviada ou recebida."
        )

    try:
        blob = decode_blob(payload.get("blob"))
        header = parse_header(blob)
    except InvalidMessage as error:
        return error_response(400, "invalid_message", str(error))

    if direction == Message.Direction.SENT:
        sender, recipient = request.user, request.peer
    else:
        sender, recipient = request.peer, request.user

    if header.sender_id != sender_id_for(sender, recipient):
        return error_response(
            400,
            "sender_mismatch",
            "O cabeçalho do arquivo indica outro remetente. A mensagem não foi salva.",
        )

    message = Message.objects.create(
        sender=sender,
        recipient=recipient,
        blob=blob,
        created_at=header.created_at,
        direction=direction,
    )

    return JsonResponse(
        {
            "id": message.pk,
            "direction": message.direction,
            "createdAt": message.created_at.isoformat(),
            "receivedAt": message.received_at.isoformat(),
            "size": len(blob),
        },
        status=201,
    )
