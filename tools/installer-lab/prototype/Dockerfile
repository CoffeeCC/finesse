# Prototype of the game store's installer sandbox: Wine (32- and 64-bit, since installer stubs are
# usually 32-bit), an invisible screen, the unpacking tools, a screenshot tool, and (for building
# test installers only) a Windows C compiler. innoextract is built from source: Debian's 1.9 can't
# read Inno Setup 6.3+.
FROM debian:bookworm-slim AS innoextract
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git build-essential cmake libboost-iostreams-dev libboost-filesystem-dev \
      libboost-date-time-dev libboost-system-dev libboost-program-options-dev liblzma-dev zlib1g-dev libbz2-dev
RUN git clone --depth 1 https://github.com/dscharrer/innoextract.git /src && cmake -S /src -B /b -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /b -j"$(nproc)" && /b/innoextract --version | head -1

FROM debian:bookworm-slim
RUN dpkg --add-architecture i386 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      wine wine32 wine64 xvfb xauth p7zip-full innoextract msitools imagemagick procps ca-certificates \
      gcc-mingw-w64-x86-64 libboost-iostreams1.74.0 libboost-filesystem1.74.0 libboost-date-time1.74.0 \
      libboost-system1.74.0 libboost-program-options1.74.0 \
 && rm -rf /var/lib/apt/lists/* && useradd -m player
COPY --from=innoextract /b/innoextract /usr/local/bin/innoextract-git
USER player
ENV WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml=" WINEARCH=win64
WORKDIR /home/player
