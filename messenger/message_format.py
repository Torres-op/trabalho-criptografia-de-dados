import struct
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MAGIC = b"MENC"
VERSION = 1
FLAG_COMPRESSED = 0x01
RESERVED_FLAGS = 0xFE
AAD_SIZE = 15
IV_SIZE = 12
HEADER_SIZE = 27
TAG_SIZE = 16
MIN_SIZE = HEADER_SIZE + TAG_SIZE
MAX_SIZE = 1_048_576


class InvalidMessage(ValueError):
    pass


@dataclass(frozen=True)
class Header:
    version: int
    compressed: bool
    sender_id: int
    created_at: datetime


def parse_header(blob):
    if not isinstance(blob, (bytes, bytearray)):
        raise InvalidMessage("Conteúdo inválido: esperado um arquivo binário.")
    if len(blob) < MIN_SIZE:
        raise InvalidMessage("Arquivo corrompido: menor que o tamanho mínimo do formato.")
    if len(blob) > MAX_SIZE:
        raise InvalidMessage(f"Arquivo grande demais: o limite é {MAX_SIZE} bytes.")
    if bytes(blob[:4]) != MAGIC:
        raise InvalidMessage("Este arquivo não é uma mensagem do aplicativo.")

    version = blob[4]
    if version != VERSION:
        raise InvalidMessage(f"Versão de formato não suportada: {version}.")

    flags = blob[5]
    if flags & RESERVED_FLAGS:
        raise InvalidMessage("Arquivo corrompido: bits reservados em uso.")

    sender_id = blob[6]
    if sender_id not in (0, 1):
        raise InvalidMessage(f"sender_id inválido: {sender_id}. Esperado 0 ou 1.")

    (millis,) = struct.unpack(">Q", bytes(blob[7:AAD_SIZE]))
    try:
        seconds, remainder = divmod(millis, 1000)
        created_at = datetime.fromtimestamp(seconds, tz=timezone.utc) + timedelta(
            milliseconds=remainder
        )
    except (OverflowError, OSError, ValueError):
        raise InvalidMessage("created_at fora do intervalo válido.") from None

    return Header(
        version=version,
        compressed=bool(flags & FLAG_COMPRESSED),
        sender_id=sender_id,
        created_at=created_at,
    )
