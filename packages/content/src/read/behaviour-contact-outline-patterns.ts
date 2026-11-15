/** Complete outline-search graphs; all context words, tables and callees are bound from operands. */
export interface OutlinePattern {
  code: string;
  /** The index register that addresses the outer outline record; the other one addresses the inner record. */
  outerRecord: "SI" | "DI";
  /** Where the routine keeps the values the report names, as offsets from BP. Pairs are X then Y. */
  frame: {
    previousInner: number;
    outerStart: [number, number];
    outerEnd: [number, number];
    testOutput: [number, number];
    translatedStart: [number, number];
    translatedEnd: [number, number];
    /** The subject's centre X minus the cached outer start X, kept before the refresh. Only the subject search has it. */
    centreBeforeRefresh?: number;
  };
}

export const candidateOutlinePatterns: OutlinePattern[] = [
  {
    code: `push bp
mov bp,sp
sub sp,#64
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{candidate}]
mov si,16:ds[bx+130]
mov al,8:ds[si+0]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[si+1]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
jmp @labelLD
labelAK: push 16:ss[bp+-10]
push cs
call $classifier
pop cx
mov 16:ss[bp+-32],ax
mov ax,16:ds[{movementAngle}]
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAW
jmp @labelJW
labelAW: mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
add di,#4
mov 16:ss[bp+-8],#1
jmp @labelJT
labelBD: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBM
cmp 16:ss[bp+-14],#32768
je @labelBM
jmp @labelJD
labelBM: mov ax,16:ds[di+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBT
jmp @labelJD
labelBT: cmp 16:ds[{movementX}],#0
jne @labelBY
cmp 16:ds[{movementY}],#0
jne @labelBY
jmp @labelJD
labelBY: mov al,8:ds[di+0]
mov ah,#0
mov bx,16:ds[{subject}]
mov dx,16:ds[bx+34]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-60],dx
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[bx+36]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-58],dx
mov ax,16:ss[bp+-60]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-56],ax
mov 16:ss[bp+-28],ax
mov ax,16:ss[bp+-58]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-54],ax
mov 16:ss[bp+-30],ax
mov 16:ss[bp+-52],#0
mov 16:ss[bp+-50],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-48],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-46],ax
lea ax,16:ss[bp+-52]
push ax
nop
push cs
call $extend
pop cx
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelDU
jmp @labelJD
labelDU: mov ax,16:ss[bp+-62]
cmp ax,16:ss[bp+-46]
jne @labelEB
mov ax,16:ss[bp+-64]
cmp ax,16:ss[bp+-48]
jne @labelEB
jmp @labelJD
labelEB: cmp 16:ss[bp+6],#0
je @labelEF
mov ax,#1
jmp @labelLH
labelEF: mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-52],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-50],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-48],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-46],ax
push 16:ss[bp+-10]
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelFY
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelFP
jmp @labelHD
labelFP: mov ax,16:ss[bp+-64]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
add 16:ds[bx+30],ax
labelFT: mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
add 16:ds[bx+32],ax
jmp @labelHI
labelFY: mov ax,16:ss[bp+-56]
mov 16:ss[bp+-34],ax
mov ax,16:ss[bp+-46]
sub ax,16:ss[bp+-50]
mov 16:ss[bp+-36],ax
mov ax,16:ss[bp+-48]
sub ax,16:ss[bp+-52]
mov 16:ss[bp+-38],ax
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-52]
push ax
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-50]
pop dx
sub dx,ax
mov 16:ss[bp+-40],dx
xor ax,ax
sub ax,16:ss[bp+-38]
mov 16:ss[bp+-42],ax
cmp 16:ss[bp+-42],#0
je @labelHD
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-34]
push ax
mov ax,16:ss[bp+-40]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-42]
mov 16:ss[bp+-62],ax
jmp @labelFT
labelHD: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov 16:ds[bx+30],ax
mov ax,16:ds[bx+36]
mov 16:ds[bx+32],ax
labelHI: push 16:ds[{subject}]
nop
push cs
call $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{candidate}]
cmp 16:ds[bx+4],#63
jne @labelHV
jmp @labelIG
labelHV: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelID
test 16:ds[bx+6],#16384
je @labelIG
labelID: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelII
labelIG: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelII: mov ax,16:ds[{subject}]
add ax,#132
mov 16:ss[bp+-44],ax
mov bx,16:ss[bp+-44]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+0],ax
mov ax,16:ss[bp+-10]
mov 16:ds[bx+4],ax
mov ax,16:ss[bp+-6]
dec ax
mov 16:ds[bx+6],ax
push bx
mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
push ax
lea ax,16:ss[bp+-52]
push ax
push cs
call $markSides
add sp,#6
mov 16:ss[bp+-2],#1
labelJD: inc 16:ss[bp+-8]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelJK
xor di,di
jmp @labelJT
labelJK: mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelJS
mov di,16:ds[bx+130]
jmp @labelJT
labelJS: add di,#4
labelJT: or di,di
je @labelJW
jmp @labelBD
labelJW: inc 16:ss[bp+-6]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelKD
xor si,si
jmp @labelLD
labelKD: add si,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelKT
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelLD
labelKT: mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelLD: or si,si
je @labelLG
jmp @labelAK
labelLG: mov ax,16:ss[bp+-2]
labelLH: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "SI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-64, -62],
      translatedStart: [-52, -50],
      translatedEnd: [-48, -46],
    },
  },
  {
    code: `push bp
mov bp,sp
sub sp,#64
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{candidate}]
mov si,16:ds[bx+130]
mov al,8:ds[si+0]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[si+1]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
jmp @labelLR
labelAK: push 16:ss[bp+-10]
push cs
call $classifier
pop cx
mov 16:ss[bp+-32],ax
mov ax,16:ds[{movementAngle}]
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAW
jmp @labelKK
labelAW: mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
add di,#4
mov 16:ss[bp+-8],#1
jmp @labelKH
labelBD: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBM
cmp 16:ss[bp+-14],#32768
je @labelBM
jmp @labelJQ
labelBM: mov ax,16:ds[di+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBT
jmp @labelJQ
labelBT: cmp 16:ds[{movementX}],#0
jne @labelBY
cmp 16:ds[{movementY}],#0
jne @labelBY
jmp @labelJQ
labelBY: mov al,8:ds[di+0]
mov ah,#0
mov bx,16:ds[{subject}]
mov dx,16:ds[bx+34]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-60],dx
mov al,8:ds[di+1]
mov ah,#0
mov bx,16:ds[{subject}]
mov dx,16:ds[bx+36]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-58],dx
mov ax,16:ss[bp+-60]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-56],ax
mov 16:ss[bp+-28],ax
mov ax,16:ss[bp+-58]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-54],ax
mov 16:ss[bp+-30],ax
mov 16:ss[bp+-52],#0
mov 16:ss[bp+-50],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-48],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-46],ax
lea ax,16:ss[bp+-52]
push ax
callf $extend
pop cx
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
callf $segment
add sp,#6
or ax,ax
jne @labelDR
jmp @labelJQ
labelDR: mov ax,16:ss[bp+-62]
cmp ax,16:ss[bp+-46]
jne @labelDY
mov ax,16:ss[bp+-64]
cmp ax,16:ss[bp+-48]
jne @labelDY
jmp @labelJQ
labelDY: cmp 16:ss[bp+6],#0
je @labelEC
mov ax,#1
labelEB: jmp @labelLW
labelEC: mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-52],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-50],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-48],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-46],ax
push 16:ss[bp+-10]
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelGB
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
callf $segment
add sp,#6
or ax,ax
jne @labelFS
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
jmp @labelGA
labelFS: mov ax,16:ss[bp+-64]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
add 16:ds[bx+30],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
add 16:ds[bx+32],ax
labelGA: jmp @labelHS
labelGB: mov ax,16:ss[bp+-56]
mov 16:ss[bp+-34],ax
mov ax,16:ss[bp+-46]
sub ax,16:ss[bp+-50]
mov 16:ss[bp+-36],ax
mov ax,16:ss[bp+-48]
sub ax,16:ss[bp+-52]
mov 16:ss[bp+-38],ax
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-52]
push ax
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-50]
pop dx
sub dx,ax
mov 16:ss[bp+-40],dx
xor ax,ax
sub ax,16:ss[bp+-38]
mov 16:ss[bp+-42],ax
cmp 16:ss[bp+-42],#0
je @labelHK
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-34]
push ax
mov ax,16:ss[bp+-40]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-42]
mov 16:ss[bp+-62],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
add 16:ds[bx+32],ax
jmp @labelHS
labelHK: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
labelHS: push 16:ds[{subject}]
callf $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{candidate}]
cmp 16:ds[bx+4],#63
jne @labelIF
mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
jmp @labelIT
labelIF: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelIO
mov bx,16:ds[{candidate}]
test 16:ds[bx+6],#16384
je @labelIR
labelIO: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelIT
labelIR: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelIT: mov ax,16:ds[{subject}]
add ax,#132
mov 16:ss[bp+-44],ax
mov bx,16:ss[bp+-44]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+0],ax
mov bx,16:ss[bp+-44]
mov ax,16:ss[bp+-10]
mov 16:ds[bx+4],ax
mov ax,16:ss[bp+-6]
dec ax
mov bx,16:ss[bp+-44]
mov 16:ds[bx+6],ax
push 16:ss[bp+-44]
mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
push ax
lea ax,16:ss[bp+-52]
push ax
push cs
call $markSides
add sp,#6
mov 16:ss[bp+-2],#1
labelJQ: inc 16:ss[bp+-8]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelJX
xor di,di
jmp @labelKH
labelJX: mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelKG
mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
jmp @labelKH
labelKG: add di,#4
labelKH: or di,di
je @labelKK
jmp @labelBD
labelKK: inc 16:ss[bp+-6]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelKR
xor si,si
jmp @labelLR
labelKR: add si,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelLH
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelLR
labelLH: mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelLR: or si,si
je @labelLU
jmp @labelAK
labelLU: mov ax,16:ss[bp+-2]
jmp @labelEB
labelLW: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "SI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-64, -62],
      translatedStart: [-52, -50],
      translatedEnd: [-48, -46],
    },
  },
  {
    code: `push bp
mov bp,sp
sub sp,#64
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{candidate}]
mov si,16:ds[bx+130]
mov al,8:ds[si+0]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[si+1]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
jmp @labelLT
labelAK: push 16:ss[bp+-10]
push cs
call $classifier
pop cx
mov 16:ss[bp+-32],ax
mov ax,16:ds[{movementAngle}]
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAW
jmp @labelKM
labelAW: mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
add di,#4
mov 16:ss[bp+-8],#1
jmp @labelKJ
labelBD: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBM
cmp 16:ss[bp+-14],#32768
je @labelBM
jmp @labelJS
labelBM: mov ax,16:ds[di+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBT
jmp @labelJS
labelBT: cmp 16:ds[{movementX}],#0
jne @labelBY
cmp 16:ds[{movementY}],#0
jne @labelBY
jmp @labelJS
labelBY: mov al,8:ds[di+0]
mov ah,#0
mov bx,16:ds[{subject}]
mov dx,16:ds[bx+34]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-60],dx
mov al,8:ds[di+1]
mov ah,#0
mov bx,16:ds[{subject}]
mov dx,16:ds[bx+36]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-58],dx
mov ax,16:ss[bp+-60]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-56],ax
mov 16:ss[bp+-28],ax
mov ax,16:ss[bp+-58]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-54],ax
mov 16:ss[bp+-30],ax
mov 16:ss[bp+-52],#0
mov 16:ss[bp+-50],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-48],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-46],ax
lea ax,16:ss[bp+-52]
push ax
nop
push cs
call $extend
pop cx
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelDV
jmp @labelJS
labelDV: mov ax,16:ss[bp+-62]
cmp ax,16:ss[bp+-46]
jne @labelEC
mov ax,16:ss[bp+-64]
cmp ax,16:ss[bp+-48]
jne @labelEC
jmp @labelJS
labelEC: cmp 16:ss[bp+6],#0
je @labelEG
mov ax,#1
labelEF: jmp @labelLY
labelEG: mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-52],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-50],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-48],ax
mov bx,16:ss[bp+-32]
shl bx,#1
mov ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-46],ax
push 16:ss[bp+-10]
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelGH
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelFY
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
jmp @labelGG
labelFY: mov ax,16:ss[bp+-64]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
add 16:ds[bx+30],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
add 16:ds[bx+32],ax
labelGG: jmp @labelHY
labelGH: mov ax,16:ss[bp+-56]
mov 16:ss[bp+-34],ax
mov ax,16:ss[bp+-46]
sub ax,16:ss[bp+-50]
mov 16:ss[bp+-36],ax
mov ax,16:ss[bp+-48]
sub ax,16:ss[bp+-52]
mov 16:ss[bp+-38],ax
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-52]
push ax
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-50]
pop dx
sub dx,ax
mov 16:ss[bp+-40],dx
xor ax,ax
sub ax,16:ss[bp+-38]
mov 16:ss[bp+-42],ax
cmp 16:ss[bp+-42],#0
je @labelHQ
mov ax,16:ss[bp+-36]
imul 16:ss[bp+-34]
push ax
mov ax,16:ss[bp+-40]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-42]
mov 16:ss[bp+-62],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
add 16:ds[bx+32],ax
jmp @labelHY
labelHQ: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
labelHY: push 16:ds[{subject}]
nop
push cs
call $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelIQ
mov bx,16:ds[{candidate}]
test 16:ds[bx+6],#16384
je @labelIT
labelIQ: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelIV
labelIT: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelIV: mov ax,16:ds[{subject}]
add ax,#132
mov 16:ss[bp+-44],ax
mov bx,16:ss[bp+-44]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+0],ax
mov bx,16:ss[bp+-44]
mov ax,16:ss[bp+-10]
mov 16:ds[bx+4],ax
mov ax,16:ss[bp+-6]
dec ax
mov bx,16:ss[bp+-44]
mov 16:ds[bx+6],ax
push 16:ss[bp+-44]
mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
push ax
lea ax,16:ss[bp+-52]
push ax
push cs
call $markSides
add sp,#6
mov 16:ss[bp+-2],#1
labelJS: inc 16:ss[bp+-8]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelJZ
xor di,di
jmp @labelKJ
labelJZ: mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelKI
mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
jmp @labelKJ
labelKI: add di,#4
labelKJ: or di,di
je @labelKM
jmp @labelBD
labelKM: inc 16:ss[bp+-6]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelKT
xor si,si
jmp @labelLT
labelKT: add si,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelLJ
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelLT
labelLJ: mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{candidateX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{candidateY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelLT: or si,si
je @labelLW
jmp @labelAK
labelLW: mov ax,16:ss[bp+-2]
jmp @labelEF
labelLY: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "SI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-64, -62],
      translatedStart: [-52, -50],
      translatedEnd: [-48, -46],
    },
  },
];

export const subjectOutlinePatterns: OutlinePattern[] = [
  {
    code: `push bp
mov bp,sp
sub sp,#64
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{subject}]
mov si,16:ds[bx+130]
mov al,8:ds[si+0]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[si+1]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
jmp @labelLX
labelAK: mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $classifier
pop cx
mov 16:ss[bp+-34],ax
mov ax,16:ds[{movementAngle}]
add ax,#32768
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAZ
jmp @labelKQ
labelAZ: mov bx,16:ds[{candidate}]
mov di,16:ds[bx+130]
mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
add di,#4
mov 16:ss[bp+-8],#1
jmp @labelKN
labelBG: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBP
cmp 16:ss[bp+-14],#32768
je @labelBP
jmp @labelJX
labelBP: mov ax,16:ds[di+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBW
jmp @labelJX
labelBW: cmp 16:ds[{movementX}],#0
jne @labelCB
cmp 16:ds[{movementY}],#0
jne @labelCB
jmp @labelJX
labelCB: mov al,8:ds[di+0]
mov ah,#0
mov bx,16:ds[{candidate}]
mov dx,16:ds[bx+30]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-56],dx
mov ax,dx
mov 16:ss[bp+-28],ax
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[bx+32]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-54],dx
mov ax,dx
mov 16:ss[bp+-30],ax
mov ax,16:ss[bp+-56]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-60],ax
mov ax,16:ss[bp+-54]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-58],ax
mov 16:ss[bp+-52],#0
mov 16:ss[bp+-50],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-48],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-46],ax
lea ax,16:ss[bp+-52]
push ax
nop
push cs
call $extend
pop cx
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelDZ
jmp @labelJX
labelDZ: mov ax,16:ss[bp+-62]
cmp ax,16:ss[bp+-46]
jne @labelEG
mov ax,16:ss[bp+-64]
cmp ax,16:ss[bp+-48]
jne @labelEG
jmp @labelJX
labelEG: cmp 16:ss[bp+6],#0
je @labelEK
mov ax,#1
jmp @labelMB
labelEK: mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-52],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-50],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-48],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-46],ax
mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelGJ
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelGA
jmp @labelHO
labelGA: mov ax,16:ss[bp+-64]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
sub 16:ds[bx+30],ax
labelGE: mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
sub 16:ds[bx+32],ax
jmp @labelHT
labelGJ: mov ax,16:ss[bp+-56]
mov 16:ss[bp+-36],ax
mov ax,16:ss[bp+-46]
sub ax,16:ss[bp+-50]
mov 16:ss[bp+-38],ax
mov ax,16:ss[bp+-48]
sub ax,16:ss[bp+-52]
mov 16:ss[bp+-40],ax
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-52]
push ax
mov ax,16:ss[bp+-40]
imul 16:ss[bp+-50]
pop dx
sub dx,ax
mov 16:ss[bp+-42],dx
xor ax,ax
sub ax,16:ss[bp+-40]
mov 16:ss[bp+-44],ax
cmp 16:ss[bp+-44],#0
je @labelHO
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-36]
push ax
mov ax,16:ss[bp+-42]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-44]
mov 16:ss[bp+-62],ax
jmp @labelGE
labelHO: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov 16:ds[bx+30],ax
mov ax,16:ds[bx+36]
mov 16:ds[bx+32],ax
labelHT: mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-32],ax
push 16:ds[{subject}]
nop
push cs
call $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{candidate}]
cmp 16:ds[bx+4],#63
jne @labelIJ
jmp @labelIU
labelIJ: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelIR
test 16:ds[bx+6],#16384
je @labelIU
labelIR: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelIW
labelIU: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelIW: mov bx,16:ds[{subject}]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+132],ax
mov ax,16:ss[bp+-10]
add ax,#32768
mov 16:ds[bx+136],ax
mov ax,16:ss[bp+-16]
cmp ax,16:ss[bp+-18]
jle @labelJM
mov ax,16:ss[bp+-32]
cmp ax,16:ss[bp+-64]
jle @labelJJ
jmp @labelJQ
labelJJ: mov bx,16:ds[{subject}]
mov 8:ds[bx+135],#1
jmp @labelJS
labelJM: mov ax,16:ss[bp+-32]
cmp ax,16:ss[bp+-64]
jle @labelJQ
jmp @labelJJ
labelJQ: mov bx,16:ds[{subject}]
mov 8:ds[bx+134],#1
labelJS: mov ax,16:ss[bp+-8]
dec ax
mov bx,16:ds[{subject}]
mov 16:ds[bx+138],ax
mov 16:ss[bp+-2],#1
labelJX: inc 16:ss[bp+-8]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelKE
xor di,di
jmp @labelKN
labelKE: mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelKM
mov di,16:ds[bx+130]
jmp @labelKN
labelKM: add di,#4
labelKN: or di,di
je @labelKQ
jmp @labelBG
labelKQ: inc 16:ss[bp+-6]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelKX
xor si,si
jmp @labelLX
labelKX: add si,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelLN
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelLX
labelLN: mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelLX: or si,si
je @labelMA
jmp @labelAK
labelMA: mov ax,16:ss[bp+-2]
labelMB: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "SI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-64, -62],
      translatedStart: [-52, -50],
      translatedEnd: [-48, -46],
      centreBeforeRefresh: -32,
    },
  },
  {
    code: `push bp
mov bp,sp
sub sp,#64
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{subject}]
mov si,16:ds[bx+130]
mov al,8:ds[si+0]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[si+1]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
jmp @labelMO
labelAK: mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $classifier
pop cx
mov 16:ss[bp+-34],ax
mov ax,16:ds[{movementAngle}]
add ax,#32768
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAZ
jmp @labelLH
labelAZ: mov bx,16:ds[{candidate}]
mov di,16:ds[bx+130]
mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
add di,#4
mov 16:ss[bp+-8],#1
jmp @labelLE
labelBG: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBP
cmp 16:ss[bp+-14],#32768
je @labelBP
jmp @labelKN
labelBP: mov ax,16:ds[di+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBW
jmp @labelKN
labelBW: cmp 16:ds[{movementX}],#0
jne @labelCB
cmp 16:ds[{movementY}],#0
jne @labelCB
jmp @labelKN
labelCB: mov al,8:ds[di+0]
mov ah,#0
mov bx,16:ds[{candidate}]
mov dx,16:ds[bx+30]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-56],dx
mov ax,dx
mov 16:ss[bp+-28],ax
mov al,8:ds[di+1]
mov ah,#0
mov bx,16:ds[{candidate}]
mov dx,16:ds[bx+32]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-54],dx
mov ax,dx
mov 16:ss[bp+-30],ax
mov ax,16:ss[bp+-56]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-60],ax
mov ax,16:ss[bp+-54]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-58],ax
mov 16:ss[bp+-52],#0
mov 16:ss[bp+-50],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-48],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-46],ax
lea ax,16:ss[bp+-52]
push ax
callf $extend
pop cx
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
callf $segment
add sp,#6
or ax,ax
jne @labelDW
jmp @labelKN
labelDW: mov ax,16:ss[bp+-62]
cmp ax,16:ss[bp+-46]
jne @labelED
mov ax,16:ss[bp+-64]
cmp ax,16:ss[bp+-48]
jne @labelED
jmp @labelKN
labelED: cmp 16:ss[bp+6],#0
je @labelEH
mov ax,#1
labelEG: jmp @labelMT
labelEH: mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-52],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-50],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-48],ax
mov bx,16:ss[bp+-34]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-46],ax
mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelGM
lea ax,16:ss[bp+-64]
push ax
lea ax,16:ss[bp+-52]
push ax
lea ax,16:ss[bp+-60]
push ax
callf $segment
add sp,#6
or ax,ax
jne @labelGD
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
jmp @labelGL
labelGD: mov ax,16:ss[bp+-64]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
sub 16:ds[bx+30],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
sub 16:ds[bx+32],ax
labelGL: jmp @labelID
labelGM: mov ax,16:ss[bp+-56]
mov 16:ss[bp+-36],ax
mov ax,16:ss[bp+-46]
sub ax,16:ss[bp+-50]
mov 16:ss[bp+-38],ax
mov ax,16:ss[bp+-48]
sub ax,16:ss[bp+-52]
mov 16:ss[bp+-40],ax
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-52]
push ax
mov ax,16:ss[bp+-40]
imul 16:ss[bp+-50]
pop dx
sub dx,ax
mov 16:ss[bp+-42],dx
xor ax,ax
sub ax,16:ss[bp+-40]
mov 16:ss[bp+-44],ax
cmp 16:ss[bp+-44],#0
je @labelHV
mov ax,16:ss[bp+-38]
imul 16:ss[bp+-36]
push ax
mov ax,16:ss[bp+-42]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-44]
mov 16:ss[bp+-62],ax
mov ax,16:ss[bp+-62]
sub ax,16:ss[bp+-30]
mov bx,16:ds[{subject}]
sub 16:ds[bx+32],ax
jmp @labelID
labelHV: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
labelID: mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-32],ax
push 16:ds[{subject}]
callf $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{candidate}]
cmp 16:ds[bx+4],#63
jne @labelIT
mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
jmp @labelJH
labelIT: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelJC
mov bx,16:ds[{candidate}]
test 16:ds[bx+6],#16384
je @labelJF
labelJC: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelJH
labelJF: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelJH: mov bx,16:ds[{subject}]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+132],ax
mov ax,16:ss[bp+-10]
add ax,#32768
mov bx,16:ds[{subject}]
mov 16:ds[bx+136],ax
mov ax,16:ss[bp+-16]
cmp ax,16:ss[bp+-18]
jle @labelKA
mov ax,16:ss[bp+-32]
cmp ax,16:ss[bp+-64]
jle @labelJX
mov bx,16:ds[{subject}]
mov 8:ds[bx+134],#1
jmp @labelJZ
labelJX: mov bx,16:ds[{subject}]
mov 8:ds[bx+135],#1
labelJZ: jmp @labelKI
labelKA: mov ax,16:ss[bp+-32]
cmp ax,16:ss[bp+-64]
jle @labelKG
mov bx,16:ds[{subject}]
mov 8:ds[bx+135],#1
jmp @labelKI
labelKG: mov bx,16:ds[{subject}]
mov 8:ds[bx+134],#1
labelKI: mov ax,16:ss[bp+-8]
dec ax
mov bx,16:ds[{subject}]
mov 16:ds[bx+138],ax
mov 16:ss[bp+-2],#1
labelKN: inc 16:ss[bp+-8]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelKU
xor di,di
jmp @labelLE
labelKU: mov ax,16:ds[di+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelLD
mov bx,16:ds[{candidate}]
mov di,16:ds[bx+130]
jmp @labelLE
labelLD: add di,#4
labelLE: or di,di
je @labelLH
jmp @labelBG
labelLH: inc 16:ss[bp+-6]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelLO
xor si,si
jmp @labelMO
labelLO: add si,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[si+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelME
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelMO
labelME: mov al,8:ds[si+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[si+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelMO: or si,si
je @labelMR
jmp @labelAK
labelMR: mov ax,16:ss[bp+-2]
jmp @labelEG
labelMT: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "SI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-64, -62],
      translatedStart: [-52, -50],
      translatedEnd: [-48, -46],
      centreBeforeRefresh: -32,
    },
  },
  {
    code: `push bp
mov bp,sp
sub sp,#68
push si
push di
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-6],#1
mov bx,16:ds[{subject}]
mov di,16:ds[bx+130]
mov al,8:ds[di+0]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-16],dx
mov ax,dx
mov 16:ss[bp+-20],ax
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,dx
mov 16:ss[bp+-26],ax
mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ds[di+2]
mov 16:ss[bp+-10],ax
jmp @labelMW
labelAK: mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $classifier
pop cx
mov 16:ss[bp+-38],ax
mov ax,16:ds[{movementAngle}]
add ax,#32768
sub ax,16:ss[bp+-10]
add ax,#16384
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jg @labelAZ
jmp @labelLP
labelAZ: mov bx,16:ds[{candidate}]
mov si,16:ds[bx+130]
mov ax,16:ds[si+2]
mov 16:ss[bp+-12],ax
add si,#4
mov 16:ss[bp+-8],#1
jmp @labelLM
labelBG: mov ax,16:ss[bp+-12]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jge @labelBP
cmp 16:ss[bp+-14],#32768
je @labelBP
jmp @labelKV
labelBP: mov ax,16:ds[si+2]
sub ax,16:ss[bp+-10]
add ax,#32768
mov 16:ss[bp+-14],ax
cmp 16:ss[bp+-14],#0
jle @labelBW
jmp @labelKV
labelBW: cmp 16:ds[{movementX}],#0
jne @labelCB
cmp 16:ds[{movementY}],#0
jne @labelCB
jmp @labelKV
labelCB: mov al,8:ds[si+0]
mov ah,#0
mov 16:ss[bp+-30],ax
mov al,8:ds[si+1]
mov ah,#0
mov 16:ss[bp+-34],ax
mov al,8:ds[si+0]
mov ah,#0
mov bx,16:ds[{candidate}]
mov dx,16:ds[bx+30]
add dx,ax
sub dx,16:ss[bp+-16]
mov 16:ss[bp+-60],dx
mov ax,dx
mov 16:ss[bp+-28],ax
mov al,8:ds[si+1]
mov ah,#0
mov bx,16:ds[{candidate}]
mov dx,16:ds[bx+32]
add dx,ax
sub dx,16:ss[bp+-22]
mov 16:ss[bp+-58],dx
mov ax,dx
mov 16:ss[bp+-32],ax
mov ax,16:ss[bp+-60]
add ax,16:ds[{movementX}]
mov 16:ss[bp+-64],ax
mov ax,16:ss[bp+-58]
add ax,16:ds[{movementY}]
mov 16:ss[bp+-62],ax
mov 16:ss[bp+-56],#0
mov 16:ss[bp+-54],#0
mov ax,16:ss[bp+-18]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-52],ax
mov ax,16:ss[bp+-24]
sub ax,16:ss[bp+-22]
mov 16:ss[bp+-50],ax
lea ax,16:ss[bp+-56]
push ax
nop
push cs
call $extend
pop cx
lea ax,16:ss[bp+-68]
push ax
lea ax,16:ss[bp+-56]
push ax
lea ax,16:ss[bp+-64]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelEG
jmp @labelKV
labelEG: mov ax,16:ss[bp+-66]
cmp ax,16:ss[bp+-50]
jne @labelEN
mov ax,16:ss[bp+-68]
cmp ax,16:ss[bp+-52]
jne @labelEN
jmp @labelKV
labelEN: cmp 16:ss[bp+6],#0
je @labelER
mov ax,#1
labelEQ: jmp @labelNB
labelER: mov bx,16:ss[bp+-38]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
mov 16:ss[bp+-56],ax
mov bx,16:ss[bp+-38]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
mov 16:ss[bp+-54],ax
mov bx,16:ss[bp+-38]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorX}]
add 16:ss[bp+-52],ax
mov bx,16:ss[bp+-38]
shl bx,#1
xor ax,ax
sub ax,16:ds[bx+{sectorY}]
add 16:ss[bp+-50],ax
mov ax,16:ss[bp+-10]
add ax,#32768
push ax
push cs
call $angleGate
pop cx
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @labelGY
lea ax,16:ss[bp+-68]
push ax
lea ax,16:ss[bp+-56]
push ax
lea ax,16:ss[bp+-64]
push ax
nop
push cs
call $segment
add sp,#6
or ax,ax
jne @labelGP
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
jmp @labelGX
labelGP: mov ax,16:ss[bp+-68]
sub ax,16:ss[bp+-28]
mov bx,16:ds[{subject}]
sub 16:ds[bx+30],ax
mov ax,16:ss[bp+-66]
sub ax,16:ss[bp+-32]
mov bx,16:ds[{subject}]
sub 16:ds[bx+32],ax
labelGX: jmp @labelIP
labelGY: mov ax,16:ss[bp+-60]
mov 16:ss[bp+-40],ax
mov ax,16:ss[bp+-50]
sub ax,16:ss[bp+-54]
mov 16:ss[bp+-42],ax
mov ax,16:ss[bp+-52]
sub ax,16:ss[bp+-56]
mov 16:ss[bp+-44],ax
mov ax,16:ss[bp+-42]
imul 16:ss[bp+-56]
push ax
mov ax,16:ss[bp+-44]
imul 16:ss[bp+-54]
pop dx
sub dx,ax
mov 16:ss[bp+-46],dx
xor ax,ax
sub ax,16:ss[bp+-44]
mov 16:ss[bp+-48],ax
cmp 16:ss[bp+-48],#0
je @labelIH
mov ax,16:ss[bp+-42]
imul 16:ss[bp+-40]
push ax
mov ax,16:ss[bp+-46]
pop dx
sub ax,dx
cwd
idiv 16:ss[bp+-48]
mov 16:ss[bp+-66],ax
mov ax,16:ss[bp+-66]
sub ax,16:ss[bp+-32]
mov bx,16:ds[{subject}]
sub 16:ds[bx+32],ax
jmp @labelIP
labelIH: mov bx,16:ds[{subject}]
mov ax,16:ds[bx+34]
mov bx,16:ds[{subject}]
mov 16:ds[bx+30],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+36]
mov bx,16:ds[{subject}]
mov 16:ds[bx+32],ax
labelIP: mov ax,16:ds[{subjectCenterX}]
sub ax,16:ss[bp+-16]
mov 16:ss[bp+-36],ax
push 16:ds[{subject}]
nop
push cs
call $refresh
pop cx
push cs
call $bounds
mov bx,16:ds[{subject}]
and 16:ds[bx+6],#-7
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+8]
mov bx,16:ds[{candidate}]
or ax,16:ds[bx+8]
test ax,#32768
jne @labelJK
mov bx,16:ds[{candidate}]
test 16:ds[bx+6],#16384
je @labelJN
labelJK: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#2
jmp @labelJP
labelJN: mov bx,16:ds[{subject}]
or 16:ds[bx+6],#4
labelJP: mov bx,16:ds[{subject}]
mov ax,16:ds[{candidate}]
mov 16:ds[bx+132],ax
mov ax,16:ss[bp+-10]
add ax,#32768
mov bx,16:ds[{subject}]
mov 16:ds[bx+136],ax
mov ax,16:ss[bp+-16]
cmp ax,16:ss[bp+-18]
jle @labelKI
mov ax,16:ss[bp+-36]
cmp ax,16:ss[bp+-68]
jle @labelKF
mov bx,16:ds[{subject}]
mov 8:ds[bx+134],#1
jmp @labelKH
labelKF: mov bx,16:ds[{subject}]
mov 8:ds[bx+135],#1
labelKH: jmp @labelKQ
labelKI: mov ax,16:ss[bp+-36]
cmp ax,16:ss[bp+-68]
jle @labelKO
mov bx,16:ds[{subject}]
mov 8:ds[bx+135],#1
jmp @labelKQ
labelKO: mov bx,16:ds[{subject}]
mov 8:ds[bx+134],#1
labelKQ: mov ax,16:ss[bp+-8]
dec ax
mov bx,16:ds[{subject}]
mov 16:ds[bx+138],ax
mov 16:ss[bp+-2],#1
labelKV: inc 16:ss[bp+-8]
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jge @labelLC
xor si,si
jmp @labelLM
labelLC: mov ax,16:ds[si+2]
mov 16:ss[bp+-12],ax
mov bx,16:ds[{candidate}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-8]
jne @labelLL
mov bx,16:ds[{candidate}]
mov si,16:ds[bx+130]
jmp @labelLM
labelLL: add si,#4
labelLM: or si,si
je @labelLP
jmp @labelBG
labelLP: inc 16:ss[bp+-6]
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jge @labelLW
xor di,di
jmp @labelMW
labelLW: add di,#4
mov ax,16:ss[bp+-18]
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-24]
mov 16:ss[bp+-22],ax
mov ax,16:ds[di+2]
mov 16:ss[bp+-10],ax
mov bx,16:ds[{subject}]
mov ax,16:ds[bx+128]
cmp ax,16:ss[bp+-6]
jne @labelMM
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
jmp @labelMW
labelMM: mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[{subjectX}]
add dx,ax
mov 16:ss[bp+-18],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[{subjectY}]
add dx,ax
mov 16:ss[bp+-24],dx
labelMW: or di,di
je @labelMZ
jmp @labelAK
labelMZ: mov ax,16:ss[bp+-2]
jmp @labelEQ
labelNB: pop di
pop si
mov sp,bp
pop bp
retf`,
    outerRecord: "DI",
    frame: {
      previousInner: -12,
      outerStart: [-16, -22],
      outerEnd: [-18, -24],
      testOutput: [-68, -66],
      translatedStart: [-56, -54],
      translatedEnd: [-52, -50],
      centreBeforeRefresh: -36,
    },
  },
];
