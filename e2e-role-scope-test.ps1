Set-Location "C:\Users\venta\Desktop\MartialSystem"
$ErrorActionPreference = 'Stop'

$saLogin = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/login" -ContentType "application/json" -Body '{"username":"venta","password":"Venta@Dojo2026!"}'
$saToken = $saLogin.data.access_token
$me = Invoke-RestMethod -Uri "http://localhost:8010/api/me" -Headers @{ Authorization = "Bearer $saToken" }
$estId = $me.data.memberships[0].establishment.id
$tree = Invoke-RestMethod -Uri ("http://localhost:8010/api/tree?establishmentId=" + $estId) -Headers @{ Authorization = "Bearer $saToken" }
$disc = $tree.data.disciplines[0].code
$stamp = Get-Date -Format "HHmmss"

$senseiUser = "sensei_" + $stamp
$instUser = "inst_" + $stamp
$guardUser = "guard_" + $stamp
$pass = "Tmp@12345"

$senseiBody = @{ establishmentId=$estId; fullName="Sensei Demo $stamp"; username=$senseiUser; password=$pass; role="sensei" } | ConvertTo-Json
$sensei = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/admin/users" -Headers @{ Authorization = "Bearer $saToken" } -ContentType "application/json" -Body $senseiBody
$senseiId = $sensei.data.profileId

$instBody = @{ establishmentId=$estId; fullName="Instructor Demo $stamp"; username=$instUser; password=$pass; role="instructor"; disciplineCodes=@($disc); senseiProfileId=$senseiId } | ConvertTo-Json
$inst = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/admin/users" -Headers @{ Authorization = "Bearer $saToken" } -ContentType "application/json" -Body $instBody
$instId = $inst.data.profileId

$guardBody = @{ establishmentId=$estId; fullName="Tutor Demo $stamp"; username=$guardUser; password=$pass; role="guardian" } | ConvertTo-Json
$guard = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/admin/users" -Headers @{ Authorization = "Bearer $saToken" } -ContentType "application/json" -Body $guardBody
$guardId = $guard.data.profileId

$studentBody = @{
  establishmentId=$estId
  disciplineCode=$disc
  fullName="Alumno Demo $stamp"
  email="alumno$stamp@test.local"
  phone="60000000"
  birthDate="2015-05-10"
  currentRank="Cinta blanca"
  instructorProfileIds=@($instId)
  tutorProfileId=$guardId
} | ConvertTo-Json
$st = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/students" -Headers @{ Authorization = "Bearer $saToken" } -ContentType "application/json" -Body $studentBody
$studentId = $st.data.student.id

$instLogin = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/login" -ContentType "application/json" -Body (@{ username=$instUser; password=$pass } | ConvertTo-Json)
$instToken = $instLogin.data.access_token
$instStudents = Invoke-RestMethod -Uri ("http://localhost:8010/api/students?establishmentId=" + $estId) -Headers @{ Authorization = "Bearer $instToken" }

$senseiLogin = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/login" -ContentType "application/json" -Body (@{ username=$senseiUser; password=$pass } | ConvertTo-Json)
$senseiToken = $senseiLogin.data.access_token
$senseiMembers = Invoke-RestMethod -Uri ("http://localhost:8010/api/admin/members?establishmentId=" + $estId) -Headers @{ Authorization = "Bearer $senseiToken" }

$guardLogin = Invoke-RestMethod -Method Post -Uri "http://localhost:8010/api/login" -ContentType "application/json" -Body (@{ username=$guardUser; password=$pass } | ConvertTo-Json)
$guardToken = $guardLogin.data.access_token
$guardPortal = Invoke-RestMethod -Uri ("http://localhost:8010/api/portal/guardian?establishmentId=" + $estId) -Headers @{ Authorization = "Bearer $guardToken" }
$guardStudentPortal = Invoke-RestMethod -Uri ("http://localhost:8010/api/portal/student?establishmentId=" + $estId + "&studentId=" + $studentId) -Headers @{ Authorization = "Bearer $guardToken" }

$senseiPerm = Invoke-RestMethod -Uri ("http://localhost:8010/api/module-permissions?establishmentId=" + $estId) -Headers @{ Authorization = "Bearer $saToken" }

$instRows = @($instStudents.data)
$senseiRows = @($senseiMembers.data)
$guardianRows = @($guardPortal.data.students)

$instructorStudentIds = $instRows | ForEach-Object { $_.student.id }
$senseiMemberIds = $senseiRows | ForEach-Object { $_.profileId }

$result = [PSCustomObject]@{
  establishmentId = $estId
  disciplineCode = $disc
  created = [PSCustomObject]@{
    senseiUsername = $senseiUser
    instructorUsername = $instUser
    guardianUsername = $guardUser
    tempPassword = $pass
    senseiProfileId = $senseiId
    instructorProfileId = $instId
    guardianProfileId = $guardId
    studentId = $studentId
  }
  validations = [PSCustomObject]@{
    instructorSeesStudent = (@($instructorStudentIds | Where-Object { $_ -eq $studentId }).Count -gt 0)
    senseiMembersCount = @($senseiRows).Count
    senseiMembersHasInstructor = (@($senseiMemberIds | Where-Object { $_ -eq $instId }).Count -gt 0)
    guardianChildrenCount = @($guardianRows).Count
    guardianCanOpenStudentPortal = ($guardStudentPortal.ok -eq $true)
    modulePermissionsSenseiContainsFinanzas = ($senseiPerm.data.sensei -contains 'finanzas')
    debugInstructorStudentIds = @($instructorStudentIds)
    debugSenseiMemberIds = @($senseiMemberIds)
  }
}

$result | ConvertTo-Json -Depth 8
