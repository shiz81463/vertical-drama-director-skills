#! V2 统一模板（2026-11-24）：文戏、武戏、险情同一套章节、同一个顺序（用户：第二段和别的段不一样，漏很多东西）。
#! 来源：《黑帮老大的圣诞礼物》E27 v2（段 2、3、5、6、7 生成验证）和 E30 v2（Gemini 照同一写法做的，6 段 24 镜全部用进成片）。
#! 旧模板在 templates/v1/，集卡写"格式: V1"才用。{{键}} 从段落源、场景卡、集卡取；{{@键}} 由 compile_v2.js 算；行首 ?(键) 表示这个键有值才要这一行。
【第{{@集}}集·{{@段名}}】
{{@片头}}
【全局视觉风格】
{{@风格锁}}
【画面质感——高优先级】
像一部用35mm胶片实拍的电影，不是CG动画：{{材质}}；{{@颜色句}}
【实拍光影规范——高优先级】
PRACTICAL EFFECTS ONLY. Every effect must look physically shot in camera on a film set on 35mm film, never added in post.
Every light lights the faces near it, the light falling off into deep darkness. Nothing glows without lighting the world around it. {{光源}} {{@特效固定1}} {{@特效固定2}}
?(光源补充){{光源补充}}
Air: {{空气}}; shoot through {{前景}} so that everything feels photographed in one real space.
Real lens and real film: highlights bloom and halate with a red-orange halo, slight chromatic fringing, softer focus at the frame edges, heavy motion blur and step-printed smearing on fast action, film grain and faint scratches; the {{高光}} highlights {{@胶片后半}}
Restraint: a few large, motivated effects rather than many small ones. Every effect has a physical cause and a physical consequence.
【场景与方位】
{{@场景块}}
【人物与道具】
{{@人物块}}
Every named character appears exactly once.
?(主体规则)【主体规则——高优先级】
?(主体规则){{主体规则}}
?(体型与比例)【体型与比例——高优先级】
?(体型与比例){{体型与比例}}
【承接画面】
第一帧就从下面的状态开始，动作接着往下走：
{{@承接}}
【戏的逻辑——高优先级】
{{逻辑}}
【人物与表演——高优先级】
?(@大表演)REAL AND VISIBLE: real people, a camera very close; the feeling shows plainly on the face and in the voice, never mimed, never a blank face. THREE LAYERS: a key reaction is a flicker, then the feeling breaking through, and it stays visible. The listener is always acting too, lips closed.
?(@小表演)SMALL AND TRUE: real people, a camera very close; two to four small physical signals at a time, never mimed, never a blank face. THREE LAYERS: a key reaction is a flicker, then the feeling leaking out, then control. The listener is always acting too, lips closed.
{{@人物句}}
{{@台词声明}}
【机位与视线——最高优先级】
{{@机位视线}}每一个眼神都落在戏里的人或东西上，单人镜头的视线擦着镜头边过去。
?(@动作质感)【动作质感——高优先级】
?(@动作质感){{@动作质感}}
【镜头语言——高优先级】
每个镜头都是一台真实摄影机在现场拍下的完整竖幅画面，地平线是平的。镜头有呼吸：手持或稳定器带着随人物呼吸的细微浮动，每一镜有起点、有落点，快慢跟着情绪走，动作落定以后镜头也慢慢停稳。景深分三层：前景虚（{{前景层|门框、肩膀、衣角、头发}}），主体实，后景是{{后景层|化开的灯和环境}}。构图用三分法和黄金比例，主体落在一侧三分线上，视线前方留出空间，人物关系靠前后纵深和站、跪、坐的姿态拉开。焦段有变化：{{焦段|广角给空间和冲势，标准镜给关系，长焦给情绪和压缩的灯}}。每个切点都由一个眼神、一句话或一个动作带出来，下一镜从上一镜停住的地方接着往下走。
Every cut has a reason (a look, a line, a reaction, a movement); each shot opens exactly where the last one ended, and no line and no action restarts after a cut. The camera is always level and the right way up, gravity pulling down, heads above feet. Every shot is one continuous image of one real space, photographed through one lens.
【本段变化】
每一项变化只在发生的那一刻出现，然后保持：{{@变化}}
【分镜】
{{@镜头}}
【结束画面】
{{@结束}}
?(@有台词)台词已经说完，所有人嘴唇合着。
【声音】
{{@声音}}
{{@结尾固定}}
?(实拍特效)Practical in-camera effects only: {{实拍特效}}.
