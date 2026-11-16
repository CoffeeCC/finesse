# The game store's install sandbox (ghcr.io/coffeecc/finesse-installer), WS4 in
# docs/agents/game-store-plan.md. Finesse starts one container from it per install, with no
# network, as a plain user, the download read-only and only the install folder writable
# (server/src/gamestore/sandbox.ts), and drives it with `finesse-sandbox` over docker exec.
#
# Inside: Wine (32- and 64-bit: installer stubs are usually 32-bit) with a ready prefix and the
# common runtimes, an invisible screen with software 3D, the unpackers (innoextract from a pinned
# commit, current 7-Zip built from source, msitools), winhelper (tools/winhelper) to read and click
# windows, and x11vnc for "Needs you". Every download below is pinned by version, commit or hash.
#
# Build from the repo root:  docker build -f docker/installer/Dockerfile -t finesse-installer .

ARG DEBIAN=debian:bookworm-slim

# ---------- innoextract, from a pinned commit (Debian's 1.9 can't read Inno Setup 6.3+) ----------
FROM ${DEBIAN} AS innoextract
ARG INNOEXTRACT_COMMIT=6e9e34ed0876014fdb46e684103ef8c3605e382e
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git build-essential cmake libboost-iostreams-dev libboost-filesystem-dev \
      libboost-date-time-dev libboost-system-dev libboost-program-options-dev liblzma-dev zlib1g-dev libbz2-dev
RUN git init -q /src && cd /src && git fetch -q --depth 1 https://github.com/dscharrer/innoextract.git "$INNOEXTRACT_COMMIT" \
 && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$INNOEXTRACT_COMMIT" \
 && cmake -S /src -B /b -DCMAKE_BUILD_TYPE=Release -DUSE_STATIC_LIBS=ON && cmake --build /b -j"$(nproc)" \
 && strip /b/innoextract && /b/innoextract --version | head -1

# ---------- 7-Zip (7zz), current, from source (p7zip 16.02 can't open some NSIS installers) ----------
FROM ${DEBIAN} AS sevenzip
ARG SEVENZIP_VERSION=2606
ARG SEVENZIP_SHA256=a4e374c8f864f51df48c2cfd0e1413ec3b2ea030deae852d6a655402ebb61ac4
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl xz-utils build-essential
RUN curl -fsSL "https://github.com/ip7z/7zip/releases/download/${SEVENZIP_VERSION%??}.${SEVENZIP_VERSION#??}/7z${SEVENZIP_VERSION}-src.tar.xz" -o /7z.tar.xz \
 && echo "${SEVENZIP_SHA256}  /7z.tar.xz" | sha256sum -c - \
 && mkdir /src && tar -xJf /7z.tar.xz -C /src \
 && cd /src/CPP/7zip/Bundles/Alone2 && make -s -j"$(nproc)" -f ../../cmpl_gcc.mak \
 && install -m 0755 b/g/7zz /7zz && strip /7zz && /7zz i | head -3

# ---------- winhelper (tools/winhelper): lists windows, clicks buttons, takes screenshots ----------
FROM ${DEBIAN} AS winhelper
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 make
COPY tools/winhelper/ /src/
RUN make -C /src winhelper.exe

# ---------- the sandbox ----------
FROM ${DEBIAN}
ARG WINE_VERSION=11.0.0.0~bookworm-1
ARG WINETRICKS_COMMIT=20260125
ENV DEBIAN_FRONTEND=noninteractive
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && mkdir -p /etc/apt/keyrings && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/debian bookworm main" > /etc/apt/sources.list.d/winehq.list \
 && apt-get update && apt-get install -y --no-install-recommends \
      winehq-stable="${WINE_VERSION}" wine-stable="${WINE_VERSION}" wine-stable-amd64="${WINE_VERSION}" wine-stable-i386="${WINE_VERSION}" \
      xvfb xauth x11vnc x11-utils libgl1-mesa-dri libglx-mesa0 mesa-vulkan-drivers libvulkan1 libvulkan1:i386 \
      msitools imagemagick procps cabextract unzip xz-utils bzip2 zstd tini \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=innoextract /b/innoextract /usr/local/bin/innoextract
COPY --from=sevenzip /7zz /usr/local/bin/7zz
COPY --from=winhelper /src/winhelper.exe /opt/finesse/winhelper.exe
COPY --chmod=0755 docker/installer/finesse-sandbox /usr/local/bin/finesse-sandbox
COPY docker/installer/winetricks.sha256 /opt/finesse/winetricks.sha256

# The base Wine prefix, with the runtimes most games want. Each job starts from a copy of it.
ENV WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml=" WINEARCH=win64 PATH=/opt/wine-stable/bin:$PATH
RUN useradd -m -u 1000 installer && mkdir -p /opt/prefix && chown installer /opt/prefix
USER installer
RUN curl -fsSL "https://raw.githubusercontent.com/Winetricks/winetricks/${WINETRICKS_COMMIT}/src/winetricks" -o /tmp/winetricks \
 && (cd /tmp && sha256sum -c /opt/finesse/winetricks.sha256) \
 && export WINEPREFIX=/opt/prefix HOME=/home/installer \
 && xvfb-run -a sh -c 'wineboot -i && wineserver -w \
      && sh /tmp/winetricks -q --unattended vcrun2022 d3dx9 d3dcompiler_47 xact && wineserver -w' \
 && rm -rf /tmp/winetricks /home/installer/.cache /opt/prefix/drive_c/windows/temp/* \
 && chmod -R a+rX /opt/prefix
RUN innoextract --version | head -1 && 7zz i | head -2 >/dev/null && wine --version

LABEL org.opencontainers.image.source="https://github.com/CoffeeCC/finesse" \
      org.opencontainers.image.description="Finesse's game install sandbox: Wine, unpackers and a virtual screen, run with no network." \
      finesse.innoextract.max="6.4.999"
WORKDIR /job
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["finesse-sandbox", "serve"]
