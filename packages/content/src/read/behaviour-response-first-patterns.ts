/** Complete compiler forms of the first selected contact response, with bound tables and callees. */
export const firstResponsePatterns = [
  `push bp
mov bp,sp
sub sp,#46
push si
push di
mov si,16:ss[bp+6]
mov ax,si
add ax,#132
mov 16:ss[bp+-38],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-36],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-40],#{tableSegment}
mov 16:ss[bp+-42],ax
mov bx,16:ss[bp+-36]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-44],#{tableSegment}
mov 16:ss[bp+-46],ax
les bx,32:ss[bp+-42]
mov ax,16:es[bx+8]
mov 16:ss[bp+-12],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+4]
mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
je @labelBJ
cmp 16:ss[bp+-2],#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add 16:ss[bp+-2],#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub 16:ss[bp+-2],#4096
labelBW: mov di,16:ds[si+54]
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+4],#5
jne @labelCE
cmp 16:ds[bx+18],#0
je @labelCE
mov 16:ss[bp+-6],#256
jmp @labelCO
labelCE: les bx,32:ss[bp+-42]
mov ax,16:es[bx+6]
les bx,32:ss[bp+-46]
cmp ax,16:es[bx+6]
jle @labelCL
les bx,32:ss[bp+-42]
jmp @labelCN
labelCL: les bx,32:ss[bp+-46]
mov ax,16:es[bx+6]
labelCN: mov 16:ss[bp+-6],ax
labelCO: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeA
pop cx
mov 16:ss[bp+-8],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-12]
cwd
xor ax,dx
sub ax,dx
mov 16:ss[bp+-14],ax
push ax
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-16],ax
or di,di
jle @labelDR
cmp 16:ss[bp+-2],#0
jg @labelDV
labelDR: or di,di
jge @labelEE
cmp 16:ss[bp+-2],#0
jge @labelEE
labelDV: push di
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-18],ax
jmp @labelEF
labelEE: mov 16:ss[bp+-18],#0
labelEF: push 16:ss[bp+-6]
mov ax,16:ss[bp+-16]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ss[bp+-18]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
push dx
callf $calleeC
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
mov dx,16:ss[bp+-32]
mov cl,#8
call $calleeD
mov 16:ss[bp+-20],ax
push ax
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-22],ax
test 16:ds[si+6],#32
je @labelFQ
cwd
xor ax,dx
sub ax,dx
add ax,#32
jmp @labelFV
labelFQ: mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#2
labelFV: mov 16:ss[bp+-22],ax
push 16:ss[bp+-14]
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-24],ax
push ax
mov ax,16:ss[bp+-8]
cwd
xor ax,dx
sub ax,dx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-26],ax
add di,16:ss[bp+-26]
or di,di
jge @labelHB
mov ax,di
add ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelHA
labelGY: mov di,16:ss[bp+-4]
jmp @labelHI
labelHA: jmp @labelHH
labelHB: mov ax,di
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jle @labelHH
jmp @labelGY
labelHH: xor di,di
labelHI: mov 16:ds[si+54],di
mov ax,16:ss[bp+-2]
add ax,#16384
test ax,#32768
je @labelHR
xor ax,ax
sub ax,di
push ax
jmp @labelHS
labelHR: push di
labelHS: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ds[si+56],ax
push si
push cs
call $calleeE
pop cx
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
cmp 16:ss[bp+-12],#0
jl @labelIW
mov dx,16:ss[bp+-28]
add ax,#1
adc dx,#0
mov cl,#9
call $calleeF
add ax,#65535
adc dx,#-1
jmp @labelJA
labelIW: mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
mov cl,#9
call $calleeF
labelJA: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#46
push si
push di
mov si,16:ss[bp+6]
mov ax,si
add ax,#132
mov 16:ss[bp+-38],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-36],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-40],#{tableSegment}
mov 16:ss[bp+-42],ax
mov bx,16:ss[bp+-36]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-44],#{tableSegment}
mov 16:ss[bp+-46],ax
les bx,32:ss[bp+-42]
mov ax,16:es[bx+8]
mov 16:ss[bp+-12],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+4]
mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
je @labelBJ
cmp 16:ss[bp+-2],#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add 16:ss[bp+-2],#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub 16:ss[bp+-2],#4096
labelBW: mov di,16:ds[si+54]
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+4],#5
jne @labelCF
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+18],#0
je @labelCF
mov 16:ss[bp+-6],#256
jmp @labelCQ
labelCF: les bx,32:ss[bp+-42]
mov ax,16:es[bx+6]
les bx,32:ss[bp+-46]
cmp ax,16:es[bx+6]
jle @labelCN
les bx,32:ss[bp+-42]
mov ax,16:es[bx+6]
jmp @labelCP
labelCN: les bx,32:ss[bp+-46]
mov ax,16:es[bx+6]
labelCP: mov 16:ss[bp+-6],ax
labelCQ: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeA
pop cx
mov 16:ss[bp+-8],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-12]
cwd
xor ax,dx
sub ax,dx
mov 16:ss[bp+-14],ax
push 16:ss[bp+-14]
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ss[bp+-16],ax
or di,di
jle @labelDT
cmp 16:ss[bp+-2],#0
jg @labelDX
labelDT: or di,di
jge @labelEG
cmp 16:ss[bp+-2],#0
jge @labelEG
labelDX: push di
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ss[bp+-18],ax
jmp @labelEH
labelEG: mov 16:ss[bp+-18],#0
labelEH: push 16:ss[bp+-6]
mov ax,16:ss[bp+-16]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ss[bp+-18]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
push dx
callf $calleeC
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
mov dx,16:ss[bp+-32]
mov ax,16:ss[bp+-34]
mov cl,#8
callf $calleeD
mov 16:ss[bp+-20],ax
push 16:ss[bp+-20]
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ss[bp+-22],ax
test 16:ds[si+6],#32
je @labelFU
mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#32
jmp @labelFZ
labelFU: mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#2
labelFZ: mov 16:ss[bp+-22],ax
push 16:ss[bp+-14]
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ss[bp+-24],ax
push 16:ss[bp+-24]
mov ax,16:ss[bp+-8]
cwd
xor ax,dx
sub ax,dx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ss[bp+-26],ax
add di,16:ss[bp+-26]
or di,di
jge @labelHG
mov ax,di
add ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelHE
mov di,16:ss[bp+-4]
jmp @labelHF
labelHE: xor di,di
labelHF: jmp @labelHO
labelHG: mov ax,di
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jle @labelHN
mov di,16:ss[bp+-4]
jmp @labelHO
labelHN: xor di,di
labelHO: mov 16:ds[si+54],di
mov ax,16:ss[bp+-2]
add ax,#16384
test ax,#32768
je @labelHX
xor ax,ax
sub ax,di
push ax
jmp @labelHY
labelHX: push di
labelHY: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
callf $calleeD
mov 16:ds[si+56],ax
push si
push cs
call $calleeE
pop cx
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
cmp 16:ss[bp+-12],#0
jl @labelJD
mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
add ax,#1
adc dx,#0
mov cl,#9
callf $calleeF
add ax,#65535
adc dx,#-1
jmp @labelJH
labelJD: mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
mov cl,#9
callf $calleeF
labelJH: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#46
push si
push di
mov si,16:ss[bp+6]
mov ax,si
add ax,#132
mov 16:ss[bp+-38],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-36],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-40],#{tableSegment}
mov 16:ss[bp+-42],ax
mov bx,16:ss[bp+-36]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-44],#{tableSegment}
mov 16:ss[bp+-46],ax
les bx,32:ss[bp+-42]
mov ax,16:es[bx+8]
mov 16:ss[bp+-12],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+4]
mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
je @labelBJ
cmp 16:ss[bp+-2],#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add 16:ss[bp+-2],#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub 16:ss[bp+-2],#4096
labelBW: mov di,16:ds[si+54]
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+4],#5
jne @labelCE
cmp 16:ds[bx+18],#0
je @labelCE
mov 16:ss[bp+-6],#256
jmp @labelCO
labelCE: les bx,32:ss[bp+-42]
mov ax,16:es[bx+6]
les bx,32:ss[bp+-46]
cmp ax,16:es[bx+6]
jle @labelCL
les bx,32:ss[bp+-42]
jmp @labelCN
labelCL: les bx,32:ss[bp+-46]
mov ax,16:es[bx+6]
labelCN: mov 16:ss[bp+-6],ax
labelCO: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeA
pop cx
mov 16:ss[bp+-8],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-12]
cwd
xor ax,dx
sub ax,dx
mov 16:ss[bp+-14],ax
push ax
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-16],ax
or di,di
jle @labelDR
cmp 16:ss[bp+-2],#0
jg @labelDV
labelDR: or di,di
jge @labelEE
cmp 16:ss[bp+-2],#0
jge @labelEE
labelDV: push di
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-18],ax
jmp @labelEF
labelEE: mov 16:ss[bp+-18],#0
labelEF: push 16:ss[bp+-6]
mov ax,16:ss[bp+-16]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ss[bp+-18]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
push dx
callf $calleeC
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
mov cl,#8
call $calleeD
mov 16:ss[bp+-20],ax
push ax
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-22],ax
test 16:ds[si+6],#32
je @labelFP
cwd
xor ax,dx
sub ax,dx
add ax,#32
jmp @labelFU
labelFP: mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#2
labelFU: mov 16:ss[bp+-22],ax
push 16:ss[bp+-14]
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-24],ax
push ax
mov ax,16:ss[bp+-8]
cwd
xor ax,dx
sub ax,dx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-26],ax
add di,16:ss[bp+-26]
or di,di
jge @labelHA
mov ax,di
add ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelGZ
labelGX: mov di,16:ss[bp+-4]
jmp @labelHH
labelGZ: jmp @labelHG
labelHA: mov ax,di
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jle @labelHG
jmp @labelGX
labelHG: xor di,di
labelHH: mov 16:ds[si+54],di
mov ax,16:ss[bp+-2]
add ax,#16384
test ax,#32768
je @labelHQ
xor ax,ax
sub ax,di
push ax
jmp @labelHR
labelHQ: push di
labelHR: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ds[si+56],ax
push si
push cs
call $calleeE
pop cx
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
cmp 16:ss[bp+-12],#0
jl @labelIU
add ax,#1
adc dx,#0
mov cl,#9
call $calleeF
add ax,#65535
adc dx,#-1
jmp @labelIY
labelIU: mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
mov cl,#9
call $calleeF
labelIY: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#42
push si
push di
mov si,16:ss[bp+6]
mov ax,si
add ax,#132
mov 16:ss[bp+-38],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-36],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-40],ax
mov bx,16:ss[bp+-36]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-42],ax
mov bx,16:ss[bp+-40]
mov ax,16:ds[bx+8]
mov 16:ss[bp+-12],ax
mov bx,16:ss[bp+-38]
mov ax,16:ds[bx+4]
mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
je @labelBH
cmp 16:ss[bp+-2],#32768
jne @labelBU
labelBH: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBO
add 16:ss[bp+-2],#4096
jmp @labelBU
labelBO: mov bx,16:ss[bp+-38]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBU
sub 16:ss[bp+-2],#4096
labelBU: mov di,16:ds[si+54]
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+4],#5
jne @labelCD
mov bx,16:ss[bp+-36]
cmp 16:ds[bx+18],#0
je @labelCD
mov 16:ss[bp+-6],#256
jmp @labelCO
labelCD: mov bx,16:ss[bp+-40]
mov ax,16:ds[bx+6]
mov bx,16:ss[bp+-42]
cmp ax,16:ds[bx+6]
jle @labelCL
mov bx,16:ss[bp+-40]
mov ax,16:ds[bx+6]
jmp @labelCN
labelCL: mov bx,16:ss[bp+-42]
mov ax,16:ds[bx+6]
labelCN: mov 16:ss[bp+-6],ax
labelCO: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeA
pop cx
mov 16:ss[bp+-8],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-12]
cwd
xor ax,dx
sub ax,dx
mov 16:ss[bp+-14],ax
push 16:ss[bp+-14]
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-16],ax
or di,di
jle @labelDR
cmp 16:ss[bp+-2],#0
jg @labelDV
labelDR: or di,di
jge @labelEE
cmp 16:ss[bp+-2],#0
jge @labelEE
labelDV: push di
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-18],ax
jmp @labelEF
labelEE: mov 16:ss[bp+-18],#0
labelEF: push 16:ss[bp+-6]
mov ax,16:ss[bp+-16]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ss[bp+-18]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
push dx
callf $calleeC
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
mov dx,16:ss[bp+-32]
mov ax,16:ss[bp+-34]
mov cl,#8
call $calleeD
mov 16:ss[bp+-20],ax
push 16:ss[bp+-20]
push 16:ss[bp+-8]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-22],ax
test 16:ds[si+6],#32
je @labelFS
mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#32
jmp @labelFX
labelFS: mov ax,16:ss[bp+-22]
cwd
xor ax,dx
sub ax,dx
add ax,#2
labelFX: mov 16:ss[bp+-22],ax
push 16:ss[bp+-14]
push 16:ss[bp+-10]
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-24],ax
push 16:ss[bp+-24]
mov ax,16:ss[bp+-8]
cwd
xor ax,dx
sub ax,dx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ss[bp+-26],ax
add di,16:ss[bp+-26]
or di,di
jge @labelHE
mov ax,di
add ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelHC
mov di,16:ss[bp+-4]
jmp @labelHD
labelHC: xor di,di
labelHD: jmp @labelHM
labelHE: mov ax,di
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jle @labelHL
mov di,16:ss[bp+-4]
jmp @labelHM
labelHL: xor di,di
labelHM: mov 16:ds[si+54],di
mov ax,16:ss[bp+-2]
add ax,#16384
test ax,#32768
je @labelHV
xor ax,ax
sub ax,di
push ax
jmp @labelHW
labelHV: push di
labelHW: xor ax,ax
sub ax,16:ss[bp+-2]
push ax
callf $calleeB
pop cx
push ax
callf $calleeC
pop cx
pop cx
mov cl,#14
call $calleeD
mov 16:ds[si+56],ax
push si
push cs
call $calleeE
pop cx
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
cmp 16:ss[bp+-12],#0
jl @labelJB
mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
add ax,#1
adc dx,#0
mov cl,#9
call $calleeF
add ax,#65535
adc dx,#-1
jmp @labelJF
labelJB: mov dx,16:ss[bp+-28]
mov ax,16:ss[bp+-30]
mov cl,#9
call $calleeF
labelJF: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
];
