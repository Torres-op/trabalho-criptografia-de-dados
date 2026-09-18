MAGIC = b"TKEY"
VERSION = 1
HEADER_SIZE = 37
TAG_SIZE = 16
MIN_SIZE = HEADER_SIZE + TAG_SIZE + 1
MAX_SIZE = 8192


class InvalidBackup(ValueError):
    pass


def validate_backup(blob):
    if not isinstance(blob, (bytes, bytearray, memoryview)):
        raise InvalidBackup("O backup precisa ser enviado como arquivo binário em base64.")

    content = bytes(blob)
    if len(content) < MIN_SIZE:
        raise InvalidBackup("O arquivo de backup está incompleto.")
    if len(content) > MAX_SIZE:
        raise InvalidBackup("O backup da chave é grande demais.")
    if not content.startswith(MAGIC):
        raise InvalidBackup("Este arquivo não é um backup de chave do Treehash.")
    if content[len(MAGIC)] != VERSION:
        raise InvalidBackup(
            f"Backup gerado por outra versão do app (versão {content[len(MAGIC)]})."
        )

    return content
