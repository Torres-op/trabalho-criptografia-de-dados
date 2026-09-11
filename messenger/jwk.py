import base64
import binascii
import json
import re

KEY_TYPE = "EC"
CURVE = "P-256"
COORDINATE_BYTES = 32
CANONICAL_MEMBERS = ("crv", "kty", "x", "y")

_BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")


class InvalidPublicKey(ValueError):
    pass


def canonical_public_jwk(value):
    if not isinstance(value, dict):
        raise InvalidPublicKey("A chave pública precisa ser um objeto JWK.")
    if "d" in value:
        raise InvalidPublicKey(
            "O valor enviado contém uma chave privada. Envie apenas a chave pública."
        )
    if value.get("kty") != KEY_TYPE:
        raise InvalidPublicKey(f"Tipo de chave não suportado: {value.get('kty')}. Esperado EC.")
    if value.get("crv") != CURVE:
        raise InvalidPublicKey(f"Curva não suportada: {value.get('crv')}. Esperado P-256.")
    for member in ("x", "y"):
        _require_coordinate(value.get(member), member)

    canonical = {member: value[member] for member in CANONICAL_MEMBERS}
    return json.dumps(canonical, sort_keys=True, separators=(",", ":"))


def load_public_jwk(canonical):
    return json.loads(canonical)


def _require_coordinate(raw, member):
    if not isinstance(raw, str) or not _BASE64URL.match(raw):
        raise InvalidPublicKey(f"A coordenada {member} precisa estar em base64url.")
    try:
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except (binascii.Error, ValueError):
        raise InvalidPublicKey(f"A coordenada {member} não é base64url válido.") from None
    if len(decoded) != COORDINATE_BYTES:
        raise InvalidPublicKey(
            f"A coordenada {member} precisa ter {COORDINATE_BYTES} bytes, tem {len(decoded)}."
        )
