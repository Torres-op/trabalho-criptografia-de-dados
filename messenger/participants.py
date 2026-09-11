from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured, PermissionDenied

PARTICIPANT_COUNT = 2


class ParticipantsNotConfigured(ImproperlyConfigured):
    pass


class NotAParticipant(PermissionDenied):
    pass


def participants():
    return get_user_model().objects.filter(profile__isnull=False).order_by("username")


def get_other_user(user):
    people = list(participants())
    if len(people) != PARTICIPANT_COUNT:
        found = ", ".join(person.get_username() for person in people) or "nenhum"
        raise ParticipantsNotConfigured(
            f"O sistema precisa de exatamente {PARTICIPANT_COUNT} participantes, "
            f"mas encontrou {len(people)} ({found}). Rode o comando seed_users e remova "
            "pelo /admin/ os perfis que sobrarem."
        )

    others = [person for person in people if person.pk != user.pk]
    if len(others) != 1:
        raise NotAParticipant(
            f"O usuário {user.get_username() or 'anônimo'} não participa das conversas deste sistema."
        )
    return others[0]


def ordered_usernames(first, second):
    return sorted((first, second), key=lambda name: name.encode("utf-16-be"))


def sender_id_for(user, other):
    username = user.get_username()
    return ordered_usernames(username, other.get_username()).index(username)
