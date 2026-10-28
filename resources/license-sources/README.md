# Upstream license texts

These unchanged files supplement wheels which do not include their own license text:

- RapidOCR 1.4.4: https://github.com/RapidAI/RapidOCR/blob/v1.4.4/LICENSE
- FlatBuffers 25.12.19: https://github.com/google/flatbuffers/blob/v25.12.19/LICENSE
- OpenSSL 3.x Apache-2.0 text: https://github.com/openssl/openssl/blob/openssl-3.6.4/LICENSE.txt
- libffi 3.4.4, bzip2 1.0.8 and xz 5.4.6: unchanged texts from the producing Conda package's `info/licenses` directory. The collector checks the frozen DLL against that package's installed binary before using its license. These tracked copies are fallbacks when the original package cache is absent.

The build collects license files from the installed, locked Python packages and the actual Python runtime into artifacts/third-party-licenses. That generated directory is bundled as resources/third-party-licenses. Original licenses and attribution remain in effect; the project's MIT license does not relicense them.
