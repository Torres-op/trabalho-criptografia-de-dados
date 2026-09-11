from django.test.runner import DiscoverRunner
from django.test.utils import override_settings

PLAIN_STATIC_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


class TestRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self.storage_override = override_settings(STORAGES=PLAIN_STATIC_STORAGES)
        self.storage_override.enable()

    def teardown_test_environment(self, **kwargs):
        self.storage_override.disable()
        super().teardown_test_environment(**kwargs)
