' Launcher VBS per Brew Panda
' Avvia Brew Panda riducendo al minimo o nascondendo la finestra di comando DOS

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strCurrentDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

strBatPath = """" & strCurrentDir & "\AVVIA_BREW_PANDA.bat"""

' 1 = Finestra normale, 0 = Nascosta, 7 = Ridotta a icona
' Usiamo 1 per la prima esecuzione (nel caso debba installare dipendenze), oppure 7 (ridotta a icona)
objShell.CurrentDirectory = strCurrentDir
objShell.Run strBatPath, 1, False
