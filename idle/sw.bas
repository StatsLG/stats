' STOPWATCH.BAS  (PicoMite / MMBasic)
CLS
PRINT "PICO STOPWATCH (SPLITS)"
PRINT "S=Split   R=Reset   Q=Quit"
PRINT STRING$(30,"-")

DIM splits(100)
lap = 0

start = TIMER

DO
  ' TIMER is in milliseconds on PicoMite
  t = (TIMER - start) / 1000.0

  ' live display (row 5, col 1)
  LOCATE 5,1
  PRINT "Time: "; FORMAT$(t,"0.00"); " s      "

  k$ = INKEY$

  IF k$ = "s" OR k$ = "S" THEN
    IF lap < 100 THEN
      lap = lap + 1
      splits(lap) = t
      PRINT
      PRINT "Split "; lap; ": "; FORMAT$(t,"0.00"); " s"
    ELSE
      PRINT
      PRINT "Max splits reached."
    ENDIF
  ENDIF

  IF k$ = "r" OR k$ = "R" THEN
    CLS
    PRINT "PICO STOPWATCH (SPLITS)"
    PRINT "S=Split   R=Reset   Q=Quit"
    PRINT STRING$(30,"-")
    lap = 0
    start = TIMER
  ENDIF

  IF k$ = "q" OR k$ = "Q" THEN EXIT DO
LOOP

PRINT
PRINT "SPLITS SUMMARY"
PRINT STRING$(30,"-")
IF lap = 0 THEN
  PRINT "(no splits)"
ELSE
  FOR i = 1 TO lap
    PRINT i; ": "; FORMAT$(splits(i),"0.00"); " s"
  NEXT i
ENDIF
END
