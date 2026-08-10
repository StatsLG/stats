CLS
PRINT "PICO STOPWATCH"
PRINT "S = Split   R = Reset   Q = Quit"
PRINT STRING$(30,"-")

DIM splits(100)
lap = 0
start = TIMER
lastT = -1

DO
  t = INT((TIMER - start) / 100)   ' tenths

  IF t <> lastT THEN
    mins = INT(t / 600)
    secs = INT((t MOD 600) / 10)
    tenths = t MOD 10

    PRINT "Time: "; mins; ":"; secs; "."; tenths
    lastT = t
  ENDIF

  k$ = INKEY$

  IF k$="s" OR k$="S" THEN
    lap = lap + 1
    splits(lap) = t
    PRINT "Split "; lap; ": "; mins; ":"; secs; "."; tenths
  ENDIF

  IF k$="r" OR k$="R" THEN
    PRINT
    PRINT "--- RESET ---"
    lap = 0
    start = TIMER
  ENDIF

  IF k$="q" OR k$="Q" THEN EXIT DO

LOOP

PRINT
PRINT "SPLIT SUMMARY"
FOR i = 1 TO lap
  mins = INT(splits(i) / 600)
  secs = INT((splits(i) MOD 600) / 10)
  tenths = splits(i) MOD 10
  PRINT i; ": "; mins; ":"; secs; "."; tenths
NEXT i

END
