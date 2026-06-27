import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';

type ComposableTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> & {
  value: string;
  /** 仅在「非组合输入中」或「组合输入结束」时回调，避免 IME 候选过程被打断。 */
  onValueChange: (value: string) => void;
};

/**
 * 组合输入（IME，如中文/日文/韩文）感知的受控 textarea。
 *
 * 问题背景：在 React Flow 节点内部，受控 textarea 每次按键都会让上层 `nodes` 数组换新并触发
 * React Flow 重渲染。若在中文输入法的「组合输入」过程中把中间态提交回 store，重渲染会把
 * `value` 写回输入框，从而打断候选词拼写。浮层里的输入（如 EdgeEditor）不经 React Flow，
 * 所以表现不同。
 *
 * 解决：用本地缓冲承载输入框真实值；组合输入期间不向上提交，`compositionend` 再一次性提交。
 * 这样无论是否在 React Flow 内，行为都一致且中文输入正常。
 */
export function ComposableTextarea({ value, onValueChange, ...rest }: ComposableTextareaProps) {
  const [local, setLocal] = useState(value);
  const composing = useRef(false);

  // 外部值变化时同步到本地（组合输入进行中除外，以免打断候选）。
  useEffect(() => {
    if (!composing.current) setLocal(value);
  }, [value]);

  return (
    <textarea
      {...rest}
      value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!composing.current) onValueChange(e.target.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        onValueChange(e.currentTarget.value);
      }}
    />
  );
}
