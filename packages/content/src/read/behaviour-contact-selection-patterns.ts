/** Complete contact candidate scans with structurally bound context words and direct calls. */
export interface SelectionPattern {
  code: string;
  /**
   * How the scan skips a candidate by type: through the helper it calls as `calleeI` with both types, or by its own
   * tests of the subject's type and then the candidate's.
   */
  typePairs: "helper" | { subject: number; candidate: number }[];
}

export const selectionPatterns: SelectionPattern[] = [
  {
    code: `push bp
mov bp,sp
push si
push di
mov ax,16:ss[bp+6]
mov 16:ds[{globalA}],ax
mov bx,16:ds[{globalA}]
cmp 16:ds[bx+130],#0
jne @labelL
xor ax,ax
jmp @labelIB
labelL: mov ax,16:ds[{globalA}]
add ax,#132
mov si,ax
mov bx,16:ds[{globalA}]
mov ax,16:ds[bx+132]
mov 16:ds[{globalB}],ax
or ax,ax
je @labelAA
mov ax,16:ds[si+4]
mov 16:ds[{globalC}],ax
push ax
push cs
call $calleeA
pop cx
mov 16:ds[{globalD}],ax
labelAA: mov al,#0
mov 8:ds[si+3],al
mov 8:ds[si+2],al
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
push cs
call $calleeC
xor di,di
cmp 16:ds[{globalB}],#0
jne @labelAO
jmp @labelDJ
labelAO: push 16:ds[{globalB}]
push 16:ds[{globalA}]
nop
push cs
call $calleeD
pop cx
pop cx
or ax,ax
je @labelAY
jmp @labelDJ
labelAY: mov ax,16:ds[{globalB}]
mov 16:ds[{globalF}],ax
mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelBE
jmp @labelDJ
labelBE: test 16:ds[bx+8],#8192
je @labelBH
jmp @labelDJ
labelBH: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelCJ
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelCJ
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelCJ
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelCJ
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelCJ
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelCJ: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelDJ
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelDJ
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelDJ
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelDJ
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelDJ
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelDJ: mov ax,#12288
push ax
nop
push cs
call $calleeH
pop cx
jmp @labelHK
labelDQ: push 16:ds[{globalF}]
push 16:ds[{globalA}]
nop
push cs
call $calleeD
pop cx
pop cx
or ax,ax
je @labelEA
jmp @labelHC
labelEA: mov ax,16:ds[{globalA}]
cmp ax,16:ds[{globalF}]
jne @labelEE
jmp @labelHC
labelEE: mov ax,16:ds[{globalB}]
cmp ax,16:ds[{globalF}]
jne @labelEI
jmp @labelHC
labelEI: mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelEM
jmp @labelHC
labelEM: test 16:ds[bx+8],#8192
je @labelEP
jmp @labelHC
labelEP: push 16:ds[bx+4]
mov bx,16:ds[{globalA}]
push 16:ds[bx+4]
nop
push cs
call $calleeI
pop cx
pop cx
or ax,ax
je @labelFA
jmp @labelHC
labelFA: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelGC
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelGC
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelGC
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelGC
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelGC
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelGC: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jg @labelHC
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jl @labelHC
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jg @labelHC
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jl @labelHC
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelHC
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelHC: mov ax,#4096
push ax
push 16:ds[{globalF}]
nop
push cs
call $calleeJ
pop cx
pop cx
labelHK: mov 16:ds[{globalF}],ax
cmp 16:ds[{globalF}],#0
je @labelHO
jmp @labelDQ
labelHO: or di,di
jne @labelHS
mov 16:ds[si+0],#0
jmp @labelIA
labelHS: push 16:ds[si+4]
push cs
call $calleeK
pop cx
or ax,ax
je @labelIA
mov bx,16:ds[{globalA}]
or 16:ds[bx+6],#1
labelIA: mov ax,di
labelIB: pop di
pop si
pop bp
retf`,
    typePairs: "helper",
  },
  {
    code: `push bp
mov bp,sp
push si
push di
mov ax,16:ss[bp+6]
mov 16:ds[{globalA}],ax
mov bx,16:ds[{globalA}]
cmp 16:ds[bx+130],#0
jne @labelL
xor ax,ax
labelK: jmp @labelHV
labelL: mov ax,16:ds[{globalA}]
add ax,#132
mov si,ax
mov bx,16:ds[{globalA}]
mov ax,16:ds[bx+132]
mov 16:ds[{globalB}],ax
or ax,ax
je @labelAA
mov ax,16:ds[si+4]
mov 16:ds[{globalC}],ax
push 16:ds[{globalC}]
push cs
call $calleeA
pop cx
mov 16:ds[{globalD}],ax
labelAA: mov al,#0
mov 8:ds[si+3],al
mov 8:ds[si+2],al
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
push cs
call $calleeC
xor di,di
cmp 16:ds[{globalB}],#0
jne @labelAO
jmp @labelDI
labelAO: push 16:ds[{globalB}]
push 16:ds[{globalA}]
callf $calleeD
pop cx
pop cx
or ax,ax
je @labelAW
jmp @labelDI
labelAW: mov ax,16:ds[{globalB}]
mov 16:ds[{globalF}],ax
mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelBC
jmp @labelDI
labelBC: mov bx,16:ds[{globalF}]
test 16:ds[bx+8],#8192
je @labelBG
jmp @labelDI
labelBG: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelCI
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelCI
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelCI
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelCI
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelCI
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelCI: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelDI
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelDI
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelDI
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelDI
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelDI
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelDI: mov ax,#12288
push ax
callf $calleeH
pop cx
jmp @labelHD
labelDN: push 16:ds[{globalF}]
push 16:ds[{globalA}]
callf $calleeD
pop cx
pop cx
or ax,ax
je @labelDV
jmp @labelGX
labelDV: mov ax,16:ds[{globalA}]
cmp ax,16:ds[{globalF}]
jne @labelDZ
jmp @labelGX
labelDZ: mov ax,16:ds[{globalB}]
cmp ax,16:ds[{globalF}]
jne @labelED
jmp @labelGX
labelED: mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelEH
jmp @labelGX
labelEH: mov bx,16:ds[{globalF}]
test 16:ds[bx+8],#8192
je @labelEL
jmp @labelGX
labelEL: mov bx,16:ds[{globalF}]
push 16:ds[bx+4]
mov bx,16:ds[{globalA}]
push 16:ds[bx+4]
callf $calleeI
pop cx
pop cx
or ax,ax
je @labelEV
jmp @labelGX
labelEV: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelFX
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelFX
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelFX
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelFX
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelFX
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelFX: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jg @labelGX
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jl @labelGX
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jg @labelGX
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jl @labelGX
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelGX
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelGX: mov ax,#4096
push ax
push 16:ds[{globalF}]
callf $calleeJ
pop cx
pop cx
labelHD: mov 16:ds[{globalF}],ax
cmp 16:ds[{globalF}],#0
je @labelHH
jmp @labelDN
labelHH: or di,di
jne @labelHL
mov 16:ds[si+0],#0
jmp @labelHT
labelHL: push 16:ds[si+4]
push cs
call $calleeK
pop cx
or ax,ax
je @labelHT
mov bx,16:ds[{globalA}]
or 16:ds[bx+6],#1
labelHT: mov ax,di
jmp @labelK
labelHV: pop di
pop si
pop bp
retf`,
    typePairs: "helper",
  },
  {
    code: `push bp
mov bp,sp
push si
push di
mov ax,16:ss[bp+6]
mov 16:ds[{globalA}],ax
mov bx,16:ds[{globalA}]
cmp 16:ds[bx+130],#0
jne @labelL
xor ax,ax
labelK: jmp @labelIA
labelL: mov ax,16:ds[{globalA}]
add ax,#132
mov si,ax
mov bx,16:ds[{globalA}]
mov ax,16:ds[bx+132]
mov 16:ds[{globalB}],ax
or ax,ax
je @labelAA
mov ax,16:ds[si+4]
mov 16:ds[{globalC}],ax
push 16:ds[{globalC}]
push cs
call $calleeA
pop cx
mov 16:ds[{globalD}],ax
labelAA: mov al,#0
mov 8:ds[si+3],al
mov 8:ds[si+2],al
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
push cs
call $calleeC
xor di,di
cmp 16:ds[{globalB}],#0
jne @labelAO
jmp @labelDK
labelAO: push 16:ds[{globalB}]
push 16:ds[{globalA}]
nop
push cs
call $calleeD
pop cx
pop cx
or ax,ax
je @labelAY
jmp @labelDK
labelAY: mov ax,16:ds[{globalB}]
mov 16:ds[{globalF}],ax
mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelBE
jmp @labelDK
labelBE: mov bx,16:ds[{globalF}]
test 16:ds[bx+8],#8192
je @labelBI
jmp @labelDK
labelBI: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelCK
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelCK
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelCK
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelCK
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelCK
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelCK: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelDK
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelDK
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelDK
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelDK
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelDK
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelDK: mov ax,#12288
push ax
nop
push cs
call $calleeH
pop cx
jmp @labelHI
labelDR: push 16:ds[{globalF}]
push 16:ds[{globalA}]
nop
push cs
call $calleeD
pop cx
pop cx
or ax,ax
je @labelEB
jmp @labelHA
labelEB: mov ax,16:ds[{globalA}]
cmp ax,16:ds[{globalF}]
jne @labelEF
jmp @labelHA
labelEF: mov ax,16:ds[{globalB}]
cmp ax,16:ds[{globalF}]
jne @labelEJ
jmp @labelHA
labelEJ: mov bx,16:ds[{globalF}]
cmp 16:ds[bx+130],#0
jne @labelEN
jmp @labelHA
labelEN: mov bx,16:ds[{globalF}]
test 16:ds[bx+8],#8192
je @labelER
jmp @labelHA
labelER: mov bx,16:ds[{globalA}]
cmp 16:ds[bx+4],#12
jne @labelEY
mov bx,16:ds[{globalF}]
cmp 16:ds[bx+4],#42
jne @labelEY
jmp @labelHA
labelEY: push cs
call $calleeE
mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jge @labelGA
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jle @labelGA
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jge @labelGA
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jle @labelGA
xor ax,ax
push ax
nop
push cs
call $calleeF
pop cx
or ax,ax
je @labelGA
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelGA: mov ax,16:ds[{globalG}]
cmp ax,16:ds[{globalH}]
jg @labelHA
mov ax,16:ds[{globalI}]
cmp ax,16:ds[{globalJ}]
jl @labelHA
mov ax,16:ds[{globalK}]
cmp ax,16:ds[{globalL}]
jg @labelHA
mov ax,16:ds[{globalM}]
cmp ax,16:ds[{globalN}]
jl @labelHA
xor ax,ax
push ax
nop
push cs
call $calleeG
pop cx
or ax,ax
je @labelHA
mov di,#1
push 16:ds[{globalA}]
push cs
call $calleeB
pop cx
mov 16:ds[{globalE}],ax
labelHA: mov ax,#4096
push ax
push 16:ds[{globalF}]
nop
push cs
call $calleeI
pop cx
pop cx
labelHI: mov 16:ds[{globalF}],ax
cmp 16:ds[{globalF}],#0
je @labelHM
jmp @labelDR
labelHM: or di,di
jne @labelHQ
mov 16:ds[si+0],#0
jmp @labelHY
labelHQ: push 16:ds[si+4]
push cs
call $calleeJ
pop cx
or ax,ax
je @labelHY
mov bx,16:ds[{globalA}]
or 16:ds[bx+6],#1
labelHY: mov ax,di
jmp @labelK
labelIA: pop di
pop si
pop bp
retf`,
    typePairs: [{ subject: 12, candidate: 42 }],
  },
];
