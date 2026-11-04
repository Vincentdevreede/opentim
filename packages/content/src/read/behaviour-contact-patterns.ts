/** Complete scalar contact filters, including compiler return-bridge variants. */
export const rangePatterns = [
  `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
mov bx,16:ss[bp+8]
mov cx,16:ss[bp+10]
cmp bx,cx
jle @labelR
mov ax,si
sub ax,cx
mov dx,bx
sub dx,cx
cmp ax,dx
ja @labelQ
labelO: mov ax,#1
jmp @labelZ
labelQ: jmp @labelY
labelR: mov ax,si
sub ax,bx
mov dx,cx
sub dx,bx
cmp ax,dx
ja @labelY
jmp @labelO
labelY: xor ax,ax
labelZ: pop si
pop bp
retf`,
  `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
mov bx,16:ss[bp+8]
mov cx,16:ss[bp+10]
cmp bx,cx
jle @labelS
mov ax,si
sub ax,cx
mov dx,bx
sub dx,cx
cmp ax,dx
ja @labelQ
mov ax,#1
jmp @labelR
labelQ: xor ax,ax
labelR: jmp @labelAC
labelS: mov ax,si
sub ax,bx
mov dx,cx
sub dx,bx
cmp ax,dx
ja @labelAA
mov ax,#1
jmp @labelAB
labelAA: xor ax,ax
labelAB: jmp @labelR
labelAC: pop si
pop bp
retf`,
];
export const typesPatterns = [
  `push bp
mov bp,sp
sub sp,#2
mov dx,16:ss[bp+6]
mov bx,16:ss[bp+8]
cmp dx,bx
jle @labelK
mov 16:ss[bp+-2],dx
mov dx,bx
mov bx,16:ss[bp+-2]
labelK: cmp dx,#12
jne @labelQ
cmp bx,#42
jne @labelQ
labelO: mov ax,#1
jmp @labelAG
labelQ: cmp dx,#42
jne @labelV
cmp bx,#52
jne @labelV
jmp @labelO
labelV: cmp dx,#54
jne @labelAA
cmp bx,#58
jne @labelAA
jmp @labelO
labelAA: cmp dx,#54
jne @labelAF
cmp bx,#54
jne @labelAF
jmp @labelO
labelAF: xor ax,ax
labelAG: mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#2
mov dx,16:ss[bp+6]
mov bx,16:ss[bp+8]
cmp dx,bx
jle @labelK
mov 16:ss[bp+-2],dx
mov dx,bx
mov bx,16:ss[bp+-2]
labelK: cmp dx,#12
jne @labelQ
cmp bx,#42
jne @labelQ
labelO: mov ax,#1
labelP: jmp @labelAH
labelQ: cmp dx,#42
jne @labelV
cmp bx,#52
jne @labelV
jmp @labelO
labelV: cmp dx,#54
jne @labelAA
cmp bx,#58
jne @labelAA
jmp @labelO
labelAA: cmp dx,#54
jne @labelAF
cmp bx,#54
jne @labelAF
jmp @labelO
labelAF: xor ax,ax
jmp @labelP
labelAH: mov sp,bp
pop bp
retf`,
];
