from django.contrib import admin, messages

from .models import Message, Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "has_key", "key_registered_at", "fingerprint_verified")
    list_filter = ("fingerprint_verified",)
    fields = ("user", "ecdh_public_key", "key_registered_at", "fingerprint_verified")
    actions = ("reset_public_key",)

    def get_readonly_fields(self, request, obj=None):
        readonly = ["ecdh_public_key", "key_registered_at"]
        if obj is not None:
            readonly.insert(0, "user")
        return readonly

    @admin.display(boolean=True, description="chave registrada")
    def has_key(self, profile):
        return profile.has_public_key

    @admin.action(description="Apagar a chave pública (libera um novo registro)")
    def reset_public_key(self, request, queryset):
        total = queryset.update(
            ecdh_public_key="",
            key_registered_at=None,
            fingerprint_verified=False,
        )
        self.message_user(
            request,
            f"{total} chave(s) apagada(s). O usuário registrará uma nova no próximo acesso.",
            messages.SUCCESS,
        )


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("sender", "recipient", "direction", "created_at", "received_at", "size")
    list_filter = ("direction",)
    date_hierarchy = "received_at"
    fields = ("sender", "recipient", "direction", "created_at", "received_at", "size")
    readonly_fields = fields

    @admin.display(description="tamanho")
    def size(self, message):
        return f"{len(message.blob)} B"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
