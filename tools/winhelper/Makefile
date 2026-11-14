# Builds winhelper.exe with mingw-w64 (apt: gcc-mingw-w64-x86-64). One static .exe, no DLLs.
CC = x86_64-w64-mingw32-gcc
CFLAGS = -O2 -Wall -Wextra -Werror -municode -static -s

winhelper.exe: winhelper.c
	$(CC) $(CFLAGS) -o $@ $< -luser32 -lgdi32

clean:
	rm -f winhelper.exe

.PHONY: clean
